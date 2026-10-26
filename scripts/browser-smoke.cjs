/* Optional smoke test: Node 22+ and a Chromium debug endpoint on port 9222. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const base = args.find(value => !value.startsWith("--")) || (process.env.REPLIT_DEV_DOMAIN && `https://${process.env.REPLIT_DEV_DOMAIN}`);
if (!base) throw new Error("Pass the website base URL as the first argument.");

(async () => {
  const target = await (await fetch("http://127.0.0.1:9222/json/new?about:blank", { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject, timer } = pending.get(message.id);
      clearTimeout(timer);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    }
  });
  const cmd = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id;
    const timer = setTimeout(() => {
      pending.delete(key);
      reject(new Error(`Timed out: ${method}`));
    }, 30000);
    pending.set(key, { resolve, reject, timer });
    ws.send(JSON.stringify({ id: key, method, params }));
  });
  const evaluate = async expression => {
    const result = await cmd("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const navigate = async page => {
    await cmd("Page.navigate", { url: `${base.replace(/\/$/, "")}/${page}` });
    await new Promise(resolve => setTimeout(resolve, 450));
  };
  try {
    await cmd("Page.enable");
    await cmd("Runtime.enable");
    await cmd("Page.bringToFront");
    const pages = fs.readdirSync(root).filter(name => name.endsWith(".html"));
    for (const width of (args.includes("--interactions-only") ? [] : [320, 390, 768, 1365])) {
      await cmd("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
      for (const page of pages) {
        await navigate(page);
        const state = await evaluate(`(async () => {
          const images = [...document.images];
          images.forEach(image => image.loading = "eager");
          const broken = (await Promise.all(images.map(image => image.decode().then(() => null).catch(() => image.src)))).filter(Boolean);
          let controls = true;
          const plus = document.querySelector('[data-scene-action="zoom-in"]');
          if (plus) {
            const model = document.querySelector('.destination-scene-diorama');
            plus.click();
            controls = model.style.getPropertyValue('--coast-zoom') !== '1.00';
            document.querySelector('[data-scene-action="reset"]').click();
            controls = controls && model.style.getPropertyValue('--coast-zoom') === '1.00';
          }
          return {
            overflow: document.documentElement.scrollWidth > innerWidth,
            broken, controls,
            h1: document.querySelectorAll('h1').length,
            main: document.querySelectorAll('main').length,
            inline: images.some(image => image.src.startsWith('data:')),
            email: [...document.querySelectorAll('a[href^="mailto:"]')].map(a => a.getAttribute('href'))
          };
        })()`);
        assert.equal(state.overflow, false, `${page} at ${width}px overflows`);
        assert.deepEqual(state.broken, [], page);
        assert.equal(state.h1, 1, page);
        assert.equal(state.main, 1, page);
        assert.equal(state.inline, false, page);
        assert.equal(state.controls, true, page);
        assert.ok(state.email.length && state.email.every(value => value === "mailto:coastbookingkenya@gmail.com"), page);
      }
      console.log(`PASS all ${pages.length} pages at ${width}px: layout, images, landmarks, email and scene controls`);
    }
    await cmd("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await navigate("");
    await evaluate("document.querySelector('.seo-faq summary').focus()");
    await cmd("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r", windowsVirtualKeyCode: 13 });
    await cmd("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    assert.equal(await evaluate("document.querySelector('.seo-faq details').open"), true);
    await evaluate("document.querySelector('.menu-toggle').click()");
    assert.equal(await evaluate("document.querySelector('.menu-toggle').getAttribute('aria-expanded')"), "true");
    await cmd("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    assert.equal(await evaluate("document.querySelector('.menu-toggle').getAttribute('aria-expanded')"), "false");
    const form = await evaluate(`(() => {
      const form = document.getElementById('quoteForm');
      form.elements.fullName.value = 'Browser test coordinator';
      form.elements.phone.value = '0712345678';
      form.elements.guests.value = '20';
      form.querySelectorAll('select').forEach(select => {
        select.value = [...select.options].find(option => option.value).value;
      });
      form.elements.arrival.value = '2099-01-10';
      form.elements.arrival.dispatchEvent(new Event('input'));
      form.elements.departure.value = '2099-01-09';
      form.elements.departure.dispatchEvent(new Event('input'));
      const rejectedDates = !form.elements.departure.validity.valid;
      form.elements.departure.value = '2099-01-12';
      form.elements.departure.dispatchEvent(new Event('input'));
      form.elements.notes.value = 'Smoke test & <sample>';
      window.open = url => { window.__testQuote = url; return null; };
      form.requestSubmit();
      return {
        rejectedDates, url: window.__testQuote,
        fallback: document.querySelector('#formMessage a')?.href
      };
    })()`);
    assert.equal(form.rejectedDates, true);
    assert.ok(form.url?.startsWith("https://wa.me/254741076845?text="));
    assert.ok(form.url.includes("%3Csample%3E") && form.url.includes("%26"));
    assert.equal(form.fallback, form.url);
    console.log("PASS keyboard FAQ, mobile menu, date validation and encoded WhatsApp handoff (not sent)");
    await cmd("Emulation.setScriptExecutionDisabled", { value: true });
    await navigate("");
    const noJS = await evaluate(`({
      links: document.querySelectorAll('#groups .group-page-link').length,
      logo: document.querySelector('.logo img').getAttribute('src'),
      faq: document.querySelectorAll('.seo-faq details').length,
      visible: getComputedStyle(document.querySelector('#groups .card')).opacity
    })`);
    assert.equal(noJS.links, 6);
    assert.equal(noJS.logo, "assets/logo.webp");
    assert.equal(noJS.faq, 5);
    assert.equal(noJS.visible, "1");
    await cmd("Emulation.setScriptExecutionDisabled", { value: false });
    assert.deepEqual(errors, []);
    console.log("PASS no-JavaScript logo, visible group links and FAQ; no browser exceptions");
  } finally {
    ws.close();
    await fetch(`http://127.0.0.1:9222/json/close/${target.id}`).catch(() => {});
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
