import { chromium, type Browser, type Page, type Response } from "playwright";
import type { Finding, ScanContext } from "../types/index.js";

const DEFAULT_TIMEOUT_MS = 5_000;
const DESKTOP_VIEWPORT = { width: 1280, height: 720 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };

interface BrowserObservation {
  response: Response | null;
  consoleErrors: string[];
  brokenImages: number;
  title: string;
  htmlLang: string | null;
  imagesWithoutAlt: number;
  formCount: number;
  desktopLoaded: boolean;
  mobileLoaded: boolean;
}

export async function runUiChecks(context: ScanContext): Promise<Finding[]> {
  const webUrl = context.config.runtime.webUrl;

  if (webUrl === undefined) {
    return [
      skippedFinding(
        "ui.runtime-config",
        "Runtime web URL is not configured.",
        "Set runtime.webUrl to enable Playwright browser checks.",
        "runtime.webUrl is missing from config.",
        []
      )
    ];
  }

  const reachable = await isReachable(webUrl, context.config.runtime.timeoutMs);
  if (!reachable.available) {
    return [
      skippedFinding(
        "ui.runtime-reachability",
        "Runtime web URL was not reachable.",
        "Start the local UI service to enable Playwright checks.",
        reachable.reason,
        [{ label: "url", value: webUrl }]
      )
    ];
  }

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    const observation = await observePage(browser, webUrl, context.config.runtime.timeoutMs);

    return [
      createPageLoadFinding(observation),
      createConsoleFinding(observation),
      createBrokenImagesFinding(observation),
      createDesktopViewportFinding(observation),
      createMobileViewportFinding(observation),
      createAccessibilityBaselineFinding(observation),
      createFormDiscoveryFinding(observation)
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Playwright error.";

    return [
      skippedFinding(
        "ui.playwright-browser",
        "Playwright Chromium browser is unavailable.",
        "Run pnpm exec playwright install chromium before running browser checks.",
        message,
        []
      )
    ];
  } finally {
    await browser?.close();
  }
}

async function observePage(
  browser: Browser,
  webUrl: string,
  configuredTimeoutMs: number | undefined
): Promise<BrowserObservation> {
  const timeoutMs = configuredTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const page = await browser.newPage({ viewport: DESKTOP_VIEWPORT });
  const consoleErrors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error" && consoleErrors.length < 5) {
      consoleErrors.push(message.text());
    }
  });

  await restrictNetworkToLocal(page);

  const response = await page.goto(webUrl, {
    waitUntil: "domcontentloaded",
    timeout: timeoutMs
  });
  const desktopLoaded = await hasVisibleDocument(page);
  const brokenImages = await countBrokenImages(page);
  const title = await page.title();
  const htmlLang = await page.locator("html").getAttribute("lang");
  const imagesWithoutAlt = await countImagesWithoutAlt(page);
  const formCount = await countForms(page);

  await page.setViewportSize(MOBILE_VIEWPORT);
  const mobileLoaded = await hasVisibleDocument(page);
  await page.close();

  return {
    response,
    consoleErrors,
    brokenImages,
    title,
    htmlLang,
    imagesWithoutAlt,
    formCount,
    desktopLoaded,
    mobileLoaded
  };
}

async function restrictNetworkToLocal(page: Page): Promise<void> {
  await page.route("**/*", async (route) => {
    const requestUrl = route.request().url();

    if (isAllowedBrowserUrl(requestUrl)) {
      await route.continue();
      return;
    }

    await route.abort();
  });
}

async function isReachable(
  webUrl: string,
  configuredTimeoutMs: number | undefined
): Promise<{ available: true } | { available: false; reason: string }> {
  const timeoutMs = configuredTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    await fetch(webUrl, {
      method: "GET",
      signal: controller.signal,
      redirect: "manual"
    });

    return { available: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown UI reachability error.";

    return { available: false, reason };
  } finally {
    clearTimeout(timeout);
  }
}

function createPageLoadFinding(observation: BrowserObservation): Finding {
  const status = observation.response?.status() ?? 0;
  const loaded = status >= 200 && status < 400;

  return {
    checkId: "ui.page-load",
    category: "ui",
    status: loaded ? "Pass" : "Warn",
    severity: loaded ? "Info" : "Low",
    finding: loaded
      ? "Configured page loaded successfully in Playwright."
      : "Configured page did not return a successful load status in Playwright.",
    recommendation: "Keep the configured UI smoke URL stable and locally reachable.",
    evidence: [{ label: "statusCode", value: status === 0 ? "not available" : String(status) }]
  };
}

function createConsoleFinding(observation: BrowserObservation): Finding {
  return {
    checkId: "ui.console-errors",
    category: "ui",
    status: observation.consoleErrors.length === 0 ? "Pass" : "Warn",
    severity: observation.consoleErrors.length === 0 ? "Info" : "Low",
    finding:
      observation.consoleErrors.length === 0
        ? "No browser console errors were observed during the smoke check."
        : "Browser console errors were observed during the smoke check and require review.",
    recommendation: "Review console errors and confirm whether they affect user-facing behavior.",
    evidence:
      observation.consoleErrors.length === 0
        ? []
        : observation.consoleErrors.map((error, index) => ({
            label: `console error ${index + 1}`,
            value: error
          }))
  };
}

function createBrokenImagesFinding(observation: BrowserObservation): Finding {
  return {
    checkId: "ui.broken-images",
    category: "ui",
    status: observation.brokenImages === 0 ? "Pass" : "Warn",
    severity: observation.brokenImages === 0 ? "Info" : "Low",
    finding:
      observation.brokenImages === 0
        ? "No broken images were observed on the configured page."
        : "Broken images were observed on the configured page.",
    recommendation: "Review image sources and local asset handling.",
    evidence: [{ label: "brokenImages", value: String(observation.brokenImages) }]
  };
}

function createDesktopViewportFinding(observation: BrowserObservation): Finding {
  return {
    checkId: "ui.viewport-desktop",
    category: "ui",
    status: observation.desktopLoaded ? "Pass" : "Warn",
    severity: observation.desktopLoaded ? "Info" : "Low",
    finding: "Desktop viewport smoke check completed.",
    recommendation: "Treat this as a smoke check, not full desktop device coverage.",
    evidence: [
      { label: "viewport", value: `${DESKTOP_VIEWPORT.width}x${DESKTOP_VIEWPORT.height}` },
      { label: "documentVisible", value: String(observation.desktopLoaded) }
    ]
  };
}

function createMobileViewportFinding(observation: BrowserObservation): Finding {
  return {
    checkId: "ui.viewport-mobile",
    category: "ui",
    status: observation.mobileLoaded ? "Pass" : "Warn",
    severity: observation.mobileLoaded ? "Info" : "Low",
    finding: "Mobile viewport smoke check completed.",
    recommendation: "Treat this as a smoke check, not full mobile device coverage.",
    evidence: [
      { label: "viewport", value: `${MOBILE_VIEWPORT.width}x${MOBILE_VIEWPORT.height}` },
      { label: "documentVisible", value: String(observation.mobileLoaded) }
    ]
  };
}

function createAccessibilityBaselineFinding(observation: BrowserObservation): Finding {
  const issues = [
    ...(observation.title.trim().length === 0 ? ["missing title"] : []),
    ...(observation.htmlLang === null || observation.htmlLang.trim().length === 0
      ? ["missing html lang"]
      : []),
    ...(observation.imagesWithoutAlt > 0 ? ["images without alt text"] : [])
  ];

  return {
    checkId: "ui.accessibility-baseline",
    category: "ui",
    status: issues.length === 0 ? "Pass" : "Warn",
    severity: issues.length === 0 ? "Info" : "Low",
    finding:
      issues.length === 0
        ? "Basic accessibility baseline signals were present."
        : "Basic accessibility baseline issues were observed.",
    recommendation: "Treat this as a baseline only; run a full accessibility audit separately.",
    evidence: [
      { label: "titlePresent", value: String(observation.title.trim().length > 0) },
      { label: "htmlLangPresent", value: String(observation.htmlLang !== null && observation.htmlLang.trim().length > 0) },
      { label: "imagesWithoutAlt", value: String(observation.imagesWithoutAlt) }
    ]
  };
}

function createFormDiscoveryFinding(observation: BrowserObservation): Finding {
  if (observation.formCount === 0) {
    return {
      checkId: "ui.form-flow-safety",
      category: "ui",
      status: "Skipped",
      severity: "Info",
      finding: "No forms were discovered on the configured smoke page.",
      recommendation:
        "Configure a representative local page with forms if form-flow discovery is required.",
      evidence: [{ label: "formsFound", value: "0" }],
      skippedReason: "No form submission flow was available on the configured page."
    };
  }

  return {
    checkId: "ui.form-flow-safety",
    category: "ui",
    status: "Skipped",
    severity: "Info",
    finding:
      "Forms were discovered, but submission was intentionally skipped to avoid mutating local data.",
    recommendation:
      "Review these forms manually or add explicit non-mutating test fixtures before automating submissions.",
    evidence: [{ label: "formsFound", value: String(observation.formCount) }],
    skippedReason: "Safe form discovery does not click buttons, submit forms, or mutate data."
  };
}

function skippedFinding(
  checkId: string,
  finding: string,
  recommendation: string,
  skippedReason: string,
  evidence: Finding["evidence"]
): Finding {
  return {
    checkId,
    category: "ui",
    status: "Skipped",
    severity: "Info",
    finding,
    recommendation,
    evidence,
    skippedReason
  };
}

async function hasVisibleDocument(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.clientWidth > 0 && document.body !== null);
}

async function countBrokenImages(page: Page): Promise<number> {
  return page.evaluate<number>(
    "[...document.images].filter((image) => image.complete && image.naturalWidth === 0).length"
  );
}

async function countImagesWithoutAlt(page: Page): Promise<number> {
  return page.evaluate<number>(
    "[...document.images].filter((image) => !image.hasAttribute('alt')).length"
  );
}

async function countForms(page: Page): Promise<number> {
  return page.evaluate<number>("document.forms.length");
}

function isAllowedBrowserUrl(requestUrl: string): boolean {
  if (
    requestUrl.startsWith("data:") ||
    requestUrl.startsWith("blob:") ||
    requestUrl === "about:blank"
  ) {
    return true;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(requestUrl);
  } catch {
    return false;
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return false;
  }

  return isLoopbackHost(parsedUrl.hostname);
}

function isLoopbackHost(hostname: string): boolean {
  const normalizedHost = hostname.toLowerCase();

  return normalizedHost === "localhost" || normalizedHost === "127.0.0.1" || normalizedHost === "::1";
}
