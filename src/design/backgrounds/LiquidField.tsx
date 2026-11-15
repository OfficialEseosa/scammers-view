"use client";

import { useRef } from "react";
import { cn } from "../utils";
import { onThemeChange, readColor, useAmbientLoop } from "./useAmbient";

const VERT = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;

// Domain-warped value noise: soft smoke ("body") plus thin contour lines, drawn as
// premultiplied foreground over a transparent canvas so the dot field shows through.
const FRAG = `precision mediump float;
uniform vec2 r;uniform float t;uniform vec3 fg;uniform vec2 m;uniform float amt;
float h(vec2 p){vec3 a=fract(vec3(p.xyx)*.1031);a+=dot(a,a.yzx+33.33);return fract((a.x+a.y)*a.z);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
return mix(mix(h(i),h(i+vec2(1,0)),u.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),u.x),u.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*n(p);p*=2.03;a*=.5;}return v;}
void main(){
 vec2 uv=gl_FragCoord.xy/r.y;
 float tt=t*.00006;
 vec2 q=vec2(fbm(uv*1.3+tt),fbm(uv*1.3-tt+3.1));
 vec2 mm=(m/r.y);
 float pull=exp(-5.*length(uv-mm));
 float v=fbm(uv*1.7+q*1.8+vec2(tt*2.,-tt)+pull*.4);
 float band=abs(fract(v*7.)-.5);
 float line=smoothstep(.07,.0,band)*.5;
 float body=smoothstep(.3,.9,v);
 body=body*body*.9;
 vec2 c=gl_FragCoord.xy/r-vec2(.62,.5);
 float vig=smoothstep(1.,.15,length(c*vec2(1.25,1.6)));
 float side=smoothstep(.0,.75,gl_FragCoord.x/r.x);
 float k=(line+body)*vig*mix(.45,1.,side);
 float a=clamp(k*amt,0.,1.);gl_FragColor=vec4(fg*a,a);
}`;

/**
 * Slow, monochrome smoke for the landing hero (WebGL). Contours drift and bend a
 * little toward the pointer. The layer is transparent and faded at both edges, so
 * the page's dot field shows through and there is no seam. It renders at reduced
 * resolution (lower still on small or low-core devices), at ~30fps when idle, and
 * stops entirely off screen or in a hidden tab (useAmbientLoop).
 */
export function LiquidField({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useAmbientLoop(
    ref,
    (canvas) => {
      const gl = canvas.getContext("webgl", { antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: "low-power", depth: false, stencil: false });
      if (!gl) return null;
      const sh = (type: number, src: string) => {
        const s = gl.createShader(type)!;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return s;
      };
      const prog = gl.createProgram()!;
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
      gl.useProgram(prog);
      canvas.dataset.on = "true";
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "p");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const uR = gl.getUniformLocation(prog, "r");
      const uT = gl.getUniformLocation(prog, "t");
      const uFg = gl.getUniformLocation(prog, "fg");
      const uM = gl.getUniformLocation(prog, "m");
      const uAmt = gl.getUniformLocation(prog, "amt");
      const setColors = () => {
        const f = readColor("--text");
        gl.uniform3f(uFg, f[0] / 255, f[1] / 255, f[2] / 255);
        // Dark smoke on white needs less ink than light smoke on black to read the same.
        gl.uniform1f(uAmt, document.documentElement.dataset.theme === "light" ? 0.34 : 0.42);
      };
      setColors();
      const stopTheme = onThemeChange(setColors);
      const lowPower = (navigator.hardwareConcurrency || 8) <= 4;
      let w = 1;
      let h = 1;
      let scale = 0.5;
      let skip = false;
      const mouse = { x: -1e4, y: -1e4, tx: -1e4, ty: -1e4 };
      const onMove = (e: PointerEvent) => {
        const r = canvas.getBoundingClientRect();
        mouse.tx = (e.clientX - r.left) * scale;
        mouse.ty = (r.height - (e.clientY - r.top)) * scale;
        if (mouse.x < -9000) {
          mouse.x = mouse.tx;
          mouse.y = mouse.ty;
        }
      };
      window.addEventListener("pointermove", onMove, { passive: true });
      return {
        resize(nw, nh, dpr) {
          // A soft, low-contrast field: well under native resolution is invisible.
          const small = nw < 700;
          scale = Math.min(dpr, 1.5) * (small || lowPower ? 0.32 : 0.45);
          w = Math.max(1, Math.round(nw * scale));
          h = Math.max(1, Math.round(nh * scale));
          canvas.width = w;
          canvas.height = h;
          gl.viewport(0, 0, w, h);
          gl.uniform2f(uR, w, h);
        },
        frame(t, dt) {
          const dx = mouse.tx - mouse.x;
          const dy = mouse.ty - mouse.y;
          mouse.x += dx * 0.04;
          mouse.y += dy * 0.04;
          // The drift is slow: every other frame is plenty unless the pointer is pulling.
          skip = !skip;
          if (skip && dt > 0 && Math.abs(dx) + Math.abs(dy) < 2) return;
          gl.uniform1f(uT, t + 40000);
          gl.uniform2f(uM, mouse.x, mouse.y);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        },
        dispose() {
          delete canvas.dataset.on;
          stopTheme();
          window.removeEventListener("pointermove", onMove);
          gl.deleteProgram(prog);
          gl.deleteBuffer(buf);
        },
      };
    },
    { maxDpr: 1.5 },
  );

  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,#000_18%,#000_60%,transparent)] [-webkit-mask-image:linear-gradient(to_bottom,transparent,#000_18%,#000_60%,transparent)]",
        className,
      )}
    >
      <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_70%_40%,color-mix(in_srgb,var(--text)_6%,transparent),transparent)]" />
      <canvas ref={ref} className="absolute inset-0 size-full opacity-0 transition-opacity duration-1000 data-[on=true]:opacity-100" />
    </div>
  );
}
