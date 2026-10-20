// Runs before every test file (vitest setupFiles): no test may ever see the real home dir,
// even one that forgets tempHome(). On Windows os.homedir() reads USERPROFILE, not HOME.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "hq-ui-test-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
// The play worktrees live under the platform data dir (lib/server/paths.ts playRootDir), not HOME.
process.env.APPDATA = path.join(home, "AppData", "Roaming");
process.env.XDG_DATA_HOME = path.join(home, ".local", "share");
