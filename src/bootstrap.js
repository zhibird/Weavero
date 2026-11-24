// Weavero — Zotero 7+ lifecycle entry shim.
//
// Plain JavaScript on purpose: Zotero loads `bootstrap.js` as a
// non-module privileged script, so the real plugin code can't
// live here directly (a TS-bundled IIFE would lose the lifecycle
// function names that Zotero looks up by name on this scope).
// Instead, the bundled `index.js` is loaded as a sub-script and
// exposes its lifecycle on `Zotero.Weavero.hooks`. This file
// stays small and stable; the bundle is what changes per release.

/* global Zotero, Services, ChromeUtils */

let activeHooks = null;

function install() {}
function uninstall() {}

async function startup({ id, version, rootURI }, reason) {
    await Zotero.initializationPromise;
    try {
        const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
        const upstream = await AddonManager.getAddonByID("weavero@mjthoraval");
        if (upstream?.isActive) {
            Zotero.debug("[Weavero for Obsidian] Disable the original Weavero before enabling this fork.");
            return;
        }
        // `ignoreCache: true` so a fresh install of the same version
        // path (e.g. during dev) actually picks up the new bundled
        // index.js. Without this the bytecode cache happily serves
        // the previous content from the same URL — silent regression.
        Services.scriptloader.loadSubScriptWithOptions(
            rootURI + "index.js",
            { ignoreCache: true });
    } catch (e) {
        Zotero.debug("[Weavero] failed to load index.js: " + e);
        return;
    }
    if (Zotero.Weavero && Zotero.Weavero.hooks
            && Zotero.Weavero.hooks.onStartup) {
        // `reason` (APP_STARTUP=1, ADDON_ENABLE=3, ADDON_INSTALL=5,
        // ADDON_UPGRADE=7, …) lets the plugin run boot-only machinery —
        // e.g. the session verify-and-repair — ONLY on a real app startup
        // (a hot-reload's repair once resurrected deliberately-closed tabs
        // from a stale boot snapshot).
        activeHooks = Zotero.Weavero.hooks;
        activeHooks.onStartup({ id, version, rootURI, reason });
    } else {
        Zotero.debug("[Weavero] index.js loaded but hooks missing");
    }
}

function shutdown(_data, reason) {
    // `reason` is Zotero's numeric bootstrap code (ADDON_DISABLE=4,
    // ADDON_UNINSTALL=6, APP_SHUTDOWN=2, ADDON_UPGRADE=7, …). Forwarded so the
    // plugin can migrate reader tabs to the main window on a real disable but
    // not on a hot-reload/upgrade or app-quit.
    const hooks = activeHooks;
    activeHooks = null;
    if (hooks && Zotero.Weavero?.hooks === hooks) {
        hooks.onShutdown(reason);
        delete Zotero.Weavero;
    }
}

function onMainWindowLoad({ window }) {
    if (activeHooks && Zotero.Weavero?.hooks === activeHooks) {
        activeHooks.onMainWindowLoad(window);
    }
}

function onMainWindowUnload({ window }) {
    if (activeHooks && Zotero.Weavero?.hooks === activeHooks) {
        activeHooks.onMainWindowUnload(window);
    }
}
