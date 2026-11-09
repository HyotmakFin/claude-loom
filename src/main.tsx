import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { applyPlatformFonts, detectPlatform } from "./lib/platform";
import "./styles/index.css";

const platform = detectPlatform();
// 字体栈按平台切换（见 styles/index.css），必须在首帧渲染前设置
document.documentElement.dataset.platform = platform;

applyPlatformFonts(platform).finally(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
