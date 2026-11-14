/** Storage key for the black / white theme choice. */
export const THEME_KEY = "sv-theme";

/** Runs before first paint so the saved theme never flashes. Dark is the default. */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"){document.documentElement.setAttribute("data-theme","light");var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content","#ffffff")}}catch(e){}})();`;
