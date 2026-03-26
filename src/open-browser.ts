import { spawn } from "node:child_process";

export async function openBrowserUrl(url: string): Promise<void> {
  await new Promise<void>((resolveOpen, rejectOpen) => {
    let command = "";
    let args: string[] = [];

    if (process.platform === "darwin") {
      command = "open";
      args = [url];
    } else if (process.platform === "win32") {
      command = "cmd";
      args = ["/c", "start", "", url];
    } else {
      command = "xdg-open";
      args = [url];
    }

    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });

    child.once("error", rejectOpen);
    child.once("spawn", () => {
      child.unref();
      resolveOpen();
    });
  });
}
