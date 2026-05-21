import { connectToChrome, isChromeRunning } from "../src/browser/chrome.js";

/**
 * DOM Scanner evaluated inside the browser context to auto-detect toggles,
 * buttons, and checkboxes corresponding to models and reasoning features.
 */
function scanPageFeatures() {
  const report = {
    models: [],
    toggles: []
  };

  // 1. Scan for toggle switches or buttons containing feature keywords (DeepThink, Search, etc.)
  // Refined keywords: we avoid generic "web" to prevent matching "webclaw" history items.
  const keywords = ["think", "search", "reason", "cot", "internet", "browse", "expert", "instant"];
  
  // Find all clickable elements
  const clickableElements = Array.from(document.querySelectorAll('button, input[type="checkbox"], [role="checkbox"], [role="switch"], a, div[class*="toggle"], div[class*="switch"], div.ds-toggle-button'));

  clickableElements.forEach((el) => {
    // SECURITY/NOISE CHECK: Ignore elements that are inside the sidebar or chat history list
    let parent = el.parentElement;
    let isSidebarOrHistory = false;
    while (parent) {
      const parentClass = (parent.className || "").toLowerCase();
      const parentId = (parent.id || "").toLowerCase();
      const parentTagName = parent.tagName.toLowerCase();
      
      if (
        parentTagName === "aside" ||
        parentClass.includes("sidebar") || 
        parentClass.includes("history") || 
        parentClass.includes("chat-list") ||
        parentClass.includes("drag") ||
        parentClass.includes("left-panel") ||
        parentId.includes("sidebar")
      ) {
        isSidebarOrHistory = true;
        break;
      }
      parent = parent.parentElement;
    }

    if (isSidebarOrHistory) return;

    const text = (el.innerText || el.textContent || "").trim().toLowerCase();
    const aria = (el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").toLowerCase();
    const idAndClass = `${el.id} ${el.className}`.toLowerCase();

    // Check if any keyword matches
    const matchedKeyword = keywords.find(kw => 
      text.includes(kw) || aria.includes(kw) || idAndClass.includes(kw)
    );

    if (matchedKeyword) {
      let selector = el.tagName.toLowerCase();
      if (el.id) {
        selector += `#${el.id}`;
      } else if (el.className) {
        const classes = el.className.split(/\s+/).filter(c => c && !c.includes(":") && !c.includes("/")).join(".");
        if (classes) selector += `.${classes}`;
      }
      
      // Clean up duplicates by selector
      if (report.toggles.some(t => t.selector === selector && t.label === text)) return;

      report.toggles.push({
        keyword: matchedKeyword,
        label: (el.innerText || el.getAttribute("aria-label") || matchedKeyword).trim().replace(/\n/g, " "),
        tagName: el.tagName,
        selector: selector,
        isActive: el.getAttribute("aria-checked") === "true" || el.checked === true || idAndClass.includes("active") || idAndClass.includes("checked")
      });
    }
  });

  // 2. Scan for Model Type Radio buttons (e.g. Instant vs Expert modes)
  const radioButtons = Array.from(document.querySelectorAll('[role="radio"], [data-model-type]'));
  radioButtons.forEach((el) => {
    const modelType = el.getAttribute("data-model-type");
    const label = el.innerText ? el.innerText.trim().replace(/\n/g, " ") : "";
    const isChecked = el.getAttribute("aria-checked") === "true";

    if (modelType || label.toLowerCase().includes("instant") || label.toLowerCase().includes("expert")) {
      report.models.push({
        type: modelType || label.toLowerCase(),
        label: label || modelType,
        selector: modelType ? `[data-model-type="${modelType}"]` : `role="radio" containing ${label}`,
        isActive: isChecked
      });
    }
  });

  // 3. Try to find model dropdown select buttons (fallback)
  const modelSelectors = Array.from(document.querySelectorAll('div, button')).filter(el => {
    const txt = (el.innerText || "").toLowerCase();
    return (txt.includes("deepseek-v3") || txt.includes("deepseek-r1") || txt.includes("qwen-max") || txt.includes("qwen-plus") || txt.includes("select model") || txt.includes("switch model"));
  });

  if (modelSelectors.length > 0 && report.models.length === 0) {
    report.modelSelectorFound = true;
    report.modelSelectorText = modelSelectors[0].innerText.trim().replace(/\n/g, " ");
  }

  return report;
}

async function run() {
  console.log("Checking if Chrome is running in debug mode...");
  if (!(await isChromeRunning())) {
    console.error("❌ Chrome is not running. Please start it using: npm run chrome");
    process.exit(1);
  }

  try {
    const { browser, context } = await connectToChrome();
    const pages = context.pages();
    
    // Find Qwen or DeepSeek tabs
    const targetPage = pages.find(p => p.url().includes("deepseek.com") || p.url().includes("qwen.ai"));
    
    if (!targetPage) {
      console.log("⚠️ No active DeepSeek or Qwen page found in your open browser tabs.");
      console.log("Opening chat.deepseek.com to demonstrate scanning...");
      const page = await context.newPage();
      await page.goto("https://chat.deepseek.com/", { waitUntil: "networkidle" });
      
      console.log("Scanning page DOM for features...");
      const features = await page.evaluate(scanPageFeatures);
      console.log("\n=== DISCOVERED FEATURES & MODEL TOGGLES ===");
      console.log(JSON.stringify(features, null, 2));
    } else {
      console.log(`Found active page: ${targetPage.url()}`);
      console.log("Scanning page DOM for features...");
      const features = await targetPage.evaluate(scanPageFeatures);
      console.log("\n=== DISCOVERED FEATURES & MODEL TOGGLES ===");
      console.log(JSON.stringify(features, null, 2));
    }

  } catch (err) {
    console.error("Error during scan:", err.message);
  }
  process.exit(0);
}

run();
