// Additional rendered accessibility, contrast, mobile-wallet and error-state checks.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const prepared = spawnSync("node", ["web/scripts/task.mjs", "path"], {
  cwd: root,
  encoding: "utf8",
});
if (prepared.status !== 0) throw new Error(prepared.stderr);
const project = prepared.stdout.trim().split("\n").at(-1);
const { chromium, devices } = await import(
  pathToFileURL(path.join(project, "node_modules/playwright/index.mjs"))
);
const { default: AxeBuilder } = await import(
  pathToFileURL(
    path.join(project, "node_modules/@axe-core/playwright/dist/index.mjs"),
  )
);
const previewPort = process.argv[2] ?? "4190";
const preview = spawn("node", ["web/scripts/preview.mjs", previewPort], {
  cwd: root,
  stdio: ["ignore", "pipe", "inherit"],
});
await new Promise((resolve, reject) => {
  preview.stdout.once("data", resolve);
  preview.once("error", reject);
  preview.once("exit", code => reject(new Error(`Preview exited ${code}`)));
});
const url = `http://127.0.0.1:${previewPort}/preview/`;
const browser = await chromium.launch({ headless: true });
const output = { checks: [], contrast: [], axe: [], errors: [] };
const pass = (name) => {
  output.checks.push({ name, passed: true });
  console.log("PASS", name);
};
async function audit(page, state) {
  const scan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  output.axe.push({
    state,
    violations: scan.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      description: v.description,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
  });
}
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => output.errors.push(e.message));
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  await audit(page, "unconfigured mobile");
  const imageUrl = await page
    .locator('meta[property="og:image"]')
    .getAttribute("content");
  assert.equal(
    (await page.request.get(new URL(imageUrl, url).href)).status(),
    200,
  );
  const favicon = await page.locator('link[rel="icon"]').getAttribute("href");
  assert.equal(
    (await page.request.get(new URL(favicon, url).href)).status(),
    200,
  );
  assert.equal(
    await page.evaluate(() =>
      document.fonts.check('600 14px "Manrope Variable"'),
    ),
    true,
  );
  pass("local share image, favicon and variable font resolve under a subpath");
  output.contrast = await page.evaluate(() => {
    const lum = (rgb) =>
      rgb
        .map((v) => {
          v /= 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        })
        .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    return [
      ".welcome h2",
      ".welcome>p",
      ".welcome .fineprint",
      ".primary",
      ".world-name",
      ".world-subtitle",
      ".world-update .muted",
      ".wallet-button",
    ].map((selector) => {
      const el = document.querySelector(selector),
        style = getComputedStyle(el);
      let bg = null;
      for (let node = el; node; node = node.parentElement) {
        const color = getComputedStyle(node).backgroundColor;
        const channels = color.match(/[\d.]+/g)?.map(Number);
        if (channels && (channels.length === 3 || channels[3] === 1)) {
          bg = color;
          break;
        }
      }
      if (!bg) throw new Error("No opaque background for " + selector);
      const foreground = style.color;
      const a = lum(
          foreground
            .match(/[\d.]+/g)
            .slice(0, 3)
            .map(Number),
        ),
        b = lum(
          bg
            .match(/[\d.]+/g)
            .slice(0, 3)
            .map(Number),
        );
      return {
        selector,
        foreground,
        background: bg,
        ratio: +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2),
      };
    });
  });
  assert(output.contrast.every((p) => p.ratio >= 4.5));
  pass("eight actual rendered text/background pairs exceed 4.5:1");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  assert(
    await page
      .getByRole("button", { name: "Browser wallet", exact: true })
      .isVisible(),
  );
  assert(
    await page
      .getByRole("button", { name: "Coinbase Wallet", exact: true })
      .isVisible(),
  );
  assert(!(await page.getByText("Injected", { exact: true }).count()));
  await audit(page, "desktop-wallet modal at 390");
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    assert(
      await page
        .getByRole("dialog")
        .evaluate((el) => el.contains(document.activeElement)),
    );
  }
  pass("native modal retains keyboard focus through repeated Tab navigation");
  await page
    .getByRole("button", { name: "Browser wallet", exact: true })
    .click();
  await page
    .getByText(
      "Wallet connection declined or unavailable. Open your wallet and try again.",
    )
    .waitFor();
  await page.keyboard.press("Escape");
  pass(
    "wallet connection failure gives inline recovery, with generic injected label hidden",
  );
  await page.getByRole("button", { name: "Open settings" }).click();
  await audit(page, "settings modal");
  await page
    .getByRole("button", { name: "About this world", exact: true })
    .click();
  await page.getByRole("heading", { name: "A world to observe" }).waitFor();
  await page.keyboard.press("Escape");
  pass("help is reachable from mobile settings");
  await page.getByRole("button", { name: "Explore local demo" }).click();
  await page.locator('[data-mode="demo"]').waitFor();
  await page
    .getByRole("button", { name: "Pause local demo", exact: true })
    .click();
  await audit(page, "demo overview");
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Intervention" })
    .selectOption("fire");
  await audit(page, "destructive tools form");
  const confirm = page.getByRole("checkbox", {
    name: /I understand this damages/,
  });
  await confirm.check();
  assert(await confirm.isChecked());
  pass("mobile destructive checkbox stays in place on focus and accepts taps");
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.getByRole("button", { name: "Life", exact: true }).click();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await audit(page, "filtered history");
  const phone = await browser.newContext({ ...devices["iPhone 13"] });
  const mobile = await phone.newPage();
  await mobile.goto(url);
  await mobile.getByRole("button", { name: "Connect", exact: true }).click();
  for (const wallet of ["MetaMask", "Coinbase Wallet", "Rabby", "Phantom"]) {
    const link = mobile.getByRole("link", {
      name: "Open in " + wallet,
      exact: true,
    });
    assert(await link.isVisible());
    const b = await link.boundingBox();
    assert(b.height >= 48);
    assert.equal(
      await link
        .locator("img")
        .evaluate((i) => i.complete && i.naturalWidth > 0),
      true,
    );
  }
  assert(
    await mobile
      .getByRole("button", { name: "Coinbase Smart Wallet", exact: true })
      .isVisible(),
  );
  const rb = await mobile
    .getByRole("link", { name: "Open in Rabby", exact: true })
    .getAttribute("href");
  assert(new URL(rb).searchParams.get("_cmd") === "open-dapp");
  assert.equal(new URL(rb).searchParams.get("dapp"), url);
  const sheet = await mobile.getByRole("dialog").boundingBox();
  assert(sheet.y > 100);
  await audit(mobile, "phone wallet sheet");
  await mobile.screenshot({
    path: path.join(root, "artifacts/wallet-mobile.png"),
  });
  await mobile.keyboard.press("Escape");
  pass(
    "phone sheet lists four wallet-app links, bundled marks and Coinbase Smart Wallet; 48px rows",
  );
  await mobile.getByRole("button", { name: "Explore local demo" }).click();
  await mobile.locator('[data-mode="demo"]').waitFor();
  const cdp = await phone.newCDPSession(mobile);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: 140, y: 400, id: 1 },
      { x: 230, y: 400, id: 2 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: 110, y: 400, id: 1 },
      { x: 260, y: 400, id: 2 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  assert(parseInt(await mobile.locator(".zoom-value").innerText()) > 100);
  pass(
    "emulated two-finger pinch zoom changes camera scale on a phone viewport",
  );
  await phone.close();
  const failures = output.axe.flatMap((a) => a.violations);
  if (failures.length)
    throw new Error("Accessibility violations: " + JSON.stringify(failures));
  pass("seven axe WCAG A/AA states contain zero violations");
  assert.deepEqual(output.errors, []);
} catch (e) {
  output.errors.push(String(e.stack));
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  preview.kill("SIGTERM");
  await fs.writeFile(
    path.join(root, "artifacts/interface-checks.json"),
    JSON.stringify(output, null, 2) + "\n",
  );
}
