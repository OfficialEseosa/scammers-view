"use client";

import { useRef } from "react";
import { onThemeChange, readColor, useAmbientLoop } from "@/design/backgrounds/useAmbient";

const VERT = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;

// The landing hero's smoke, retuned to sit behind a graph: centred, quieter,
// slower, with fewer contour lines so nodes and labels stay the loudest thing.
const FRAG = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 r;uniform float t;uniform vec3 fg;uniform float amt;
float h(vec2 p){vec3 a=fract(vec3(p.xyx)*.1031);a+=dot(a,a.yzx+33.33);return fract((a.x+a.y)*a.z);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
return mix(mix(h(i),h(i+vec2(1,0)),u.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),u.x),u.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*n(p);p*=2.03;a*=.5;}return v;}
void main(){
 vec2 uv=gl_FragCoord.xy/r.y;
 float tt=t*.00004;
 vec2 q=vec2(fbm(uv*1.1+tt),fbm(uv*1.1-tt+3.1));
 float v=fbm(uv*1.5+q*2.+vec2(tt*1.6,-tt));
 float band=abs(fract(v*5.)-.5);
 float line=smoothstep(.04,.0,band)*.14;
 float body=smoothstep(.38,.95,v);
 body=body*body;
 vec2 c=gl_FragCoord.xy/r-.5;
 c.x*=r.x/r.y;
 float d=length(c);
 float vig=smoothstep(.95,.12,d);
 float k=(line+body)*vig;
 float a=clamp(k*amt,0.,1.);gl_FragColor=vec4(fg*a,a);
}`;

/**
 * Slow monochrome smoke behind the 3D graph. Renders at a fraction of native
 * resolution, at most every other frame, stops off screen or in a hidden tab,
 * and draws one still frame under reduced motion (all via useAmbientLoop).
 */
export function MapLiquid() {
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
      const uAmt = gl.getUniformLocation(prog, "amt");
      const setColors = () => {
        const f = readColor("--text");
        gl.uniform3f(uFg, f[0] / 255, f[1] / 255, f[2] / 255);
        gl.uniform1f(uAmt, document.documentElement.dataset.theme === "light" ? 0.16 : 0.24);
      };
      setColors();
      const stopTheme = onThemeChange(setColors);
      const lowPower = (navigator.hardwareConcurrency || 8) <= 4;
      let skip = false;
      let dead = false;
      return {
        resize(nw, nh, dpr) {
          const scale = Math.min(dpr, 1.5) * (nw < 700 || lowPower ? 0.28 : 0.4);
          const w = Math.max(1, Math.round(nw * scale));
          const h = Math.max(1, Math.round(nh * scale));
          canvas.width = w;
          canvas.height = h;
          gl.viewport(0, 0, w, h);
          gl.uniform2f(uR, w, h);
        },
        frame(t, dt) {
          if (dead) return;
          skip = !skip;
          if (skip && dt > 0) return;
          gl.uniform1f(uT, t + 52000);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        },
        dispose() {
          dead = true;
          delete canvas.dataset.on;
          stopTheme();
          gl.deleteProgram(prog);
          gl.deleteBuffer(buf);
        },
      };
    },
    { maxDpr: 1.5 },
  );

  return (
    <div aria-hidden className="g3-liquid">
      <canvas ref={ref} />
    </div>
  );
}
