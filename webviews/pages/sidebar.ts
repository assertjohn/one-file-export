import App from "../components/Sidebar.svelte";
import { provideVSCodeDesignSystem, allComponents } from "@vscode/webview-ui-toolkit";

// Register all components
provideVSCodeDesignSystem().register(allComponents);

const app = new App({
  target: document.body,
});

export default app;