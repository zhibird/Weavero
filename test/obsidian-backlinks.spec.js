/* global describe, it, before, after, assert, Zotero, Services, wvT */

describe("Weavero — Obsidian backlinks", function () {
    this.timeout(30000);
    const MENU = "一键复制Zotero link";
    const OBSIDIAN = "obsidian://open?vault=Research%20Notes&file=Paper%20notes";
    let wv, paper, pdf, note, ink, doc, fakeReader, base;

    const annotate = async (type, position, comment = "") => {
        const annotation = /** @type {any} */ (new Zotero.Item("annotation"));
        annotation.libraryID = pdf.libraryID;
        annotation.parentID = pdf.id;
        annotation.annotationType = type;
        annotation.annotationColor = "#ffd400";
        annotation.annotationPageLabel = "1";
        annotation.annotationSortIndex = "00000|000001|00000";
        annotation.annotationComment = comment;
        annotation.annotationPosition = JSON.stringify(position);
        await annotation.saveTx();
        return annotation;
    };

    before(async () => {
        wv = wvT.plugin();
        doc = Zotero.getMainWindow().document;
        paper = await wvT.createItem("journalArticle", {
            title: "Learning Personalized Longitudinal Imaging",
            shortTitle: "Longitudinal imaging",
        });
        pdf = await wvT.createTestPDFItem("wv-obsidian-backlinks", { parentItemID: paper.id });
        fakeReader = { type: "pdf", itemID: pdf.id, _item: pdf };
        base = "zotero://open/library/items/" + pdf.key;
        note = await annotate("note", { pageIndex: 0, rects: [[10, 10, 34, 34]] }, "[导读](" + OBSIDIAN + ")");
        ink = await annotate("ink", { pageIndex: 0, width: 2, paths: [[10, 10, 40, 40]] });
    });

    after(async () => {
        await wvT.erase(ink, note, pdf, paper);
    });

    const copyFromMenu = (handler, reader, params) => {
        const entries = [];
        const original = wv._wvCopyObsidianBacklinks;
        let links;
        wv._wvCopyObsidianBacklinks = urls => { links = Array.from(urls); };
        try {
            wv[handler]({ reader, params, append: (...items) => entries.push(...items) });
            const command = entries.find(entry => entry.label === MENU);
            assert.isOk(command, "the Obsidian action is available");
            command.onCommand();
            return links;
        } finally {
            if (original === undefined) delete wv._wvCopyObsidianBacklinks;
            else wv._wvCopyObsidianBacklinks = original;
        }
    };

    it("copies the clicked PDF page when there is no position data", () => {
        const links = copyFromMenu("_viewContextHandlerImpl", fakeReader, { position: { pageIndex: 0 } });
        assert.deepEqual(links, [base + "?page=1"]);
    });

    it("prefers the exact clicked position and keeps a page fallback", () => {
        const original = wv._wvClickPointToPdf;
        wv._wvClickPointToPdf = () => ({ pageIndex: 0, x: 45, y: 70 });
        try {
            const [link] = copyFromMenu("_viewContextHandlerImpl", fakeReader, { position: { pageIndex: 0 } });
            assert.match(link, /\?page=1&wvpos=.+/);
            const position = wv._wvDecodeSelectionPos(new URL(link).searchParams.get("wvpos"));
            assert.equal(position.kind, "pin");
            assert.deepEqual(position.position.rects, [[45, 70, 45, 70]]);
            assert.equal(wv._wvObsidianBacklinkDefaultTitle(link), "定位点 45, 70 · 第 1 页 · Longitudinal imaging");
        } finally { wv._wvClickPointToPdf = original; }
    });

    it("uses a text selection's location when the menu opens on its text", () => {
        const reader = { ...fakeReader, _wvLastSelection: {
            position: { pageIndex: 0, rects: [[10, 10, 40, 40], [10, 43, 45, 60]] },
            text: "A selected paragraph",
        } };
        const [link] = copyFromMenu("_viewContextHandlerImpl", reader, { position: { pageIndex: 0 } });
        assert.match(link, /\?page=1&wvpos=.+/);
        const position = wv._wvDecodeSelectionPos(new URL(link).searchParams.get("wvpos"));
        assert.equal(position.kind, "text");
        assert.equal(position.text, reader._wvLastSelection.text);
        assert.deepEqual(position.position.rects, reader._wvLastSelection.position.rects);
        assert.equal(wv._wvObsidianBacklinkDefaultTitle(link), "A selected paragraph · 第 1 页 · Longitudinal imaging");
    });

    it("keeps the sticky note and ink annotation keys in their selection order", () => {
        const links = copyFromMenu("_contextHandlerImpl", fakeReader, { ids: [note.key, ink.key] });
        assert.deepEqual(links, [base + "?annotation=" + note.key, base + "?annotation=" + ink.key]);
    });

    it("keeps source-specific defaults for each Markdown link and accepts a custom title", async () => {
        wvT.method("_wvCopyObsidianBacklinks");
        wvT.method("_wvPromptObsidianBacklinkTitle");
        const prompt = wv._wvPromptObsidianBacklinkTitle;
        const clipboard = Zotero.Utilities.Internal.copyTextToClipboard;
        const copies = [];
        let answer;
        const prompts = [];
        wv._wvPromptObsidianBacklinkTitle = defaultTitle => { prompts.push(defaultTitle); return answer; };
        Zotero.Utilities.Internal.copyTextToClipboard = value => { copies.push(value); };
        try {
            answer = "  ";
            const noteLink = base + "?annotation=" + note.key;
            const inkLink = base + "?annotation=" + ink.key;
            wv._wvCopyObsidianBacklinks([noteLink, inkLink, base + "?page=2"]);
            await wvT.waitFor(() => copies.length === 1);
            assert.equal(copies[0], [
                "[导读 · 第 1 页 · Longitudinal imaging](" + noteLink + ")",
                "[Ink annotation " + ink.key.slice(-4) + " · 第 1 页 · Longitudinal imaging](" + inkLink + ")",
                "[第 2 页 · Longitudinal imaging](" + base + "?page=2)",
            ].join("\n"));
            assert.deepEqual(prompts, [null], "a batch uses one prompt and separate defaults");

            answer = " Figure [1] ";
            wv._wvCopyObsidianBacklinks([base + "?page=1", base + "?page=2"]);
            await wvT.waitFor(() => copies.length === 2);
            assert.equal(copies[1], "[Figure \\[1\\]](" + base + "?page=1)\n"
                + "[Figure \\[1\\]](" + base + "?page=2)");

            answer = null;
            wv._wvCopyObsidianBacklinks([base + "?page=1"]);
            await wvT.waitFor(() => prompts.length === 3);
            assert.equal(prompts[2], "第 1 页 · Longitudinal imaging");
            assert.lengthOf(copies, 2);
        } finally {
            wv._wvPromptObsidianBacklinkTitle = prompt;
            Zotero.Utilities.Internal.copyTextToClipboard = clipboard;
        }
    });

    it("shows a bare Obsidian URI as a purple link and retains its raw source", async () => {
        await wvT.withPref("weavero.enableAppLinks", true, () =>
            wvT.withPref("weavero.enableObsidianScheme", true, () => {
                const text = OBSIDIAN + "\n[自定义标题](" + OBSIDIAN + ")";
                const box = doc.createElement("div");
                box.appendChild(wv._buildCommentFragment(text, {
                    doc, useMd: true, stripMarkers: true, lineBreaks: true, labelObsidian: true,
                }));
                const links = box.querySelectorAll(".wv-url-span.wv-link-app");
                assert.lengthOf(links, 2);
                assert.equal(links[0].textContent, "跳转到obsidian");
                assert.equal(links[0].getAttribute("data-href"), OBSIDIAN);
                assert.equal(links[1].textContent, "自定义标题");
                assert.equal(wv._reconstructSourceFromSpans(box), text);
            }));
    });

    it("shows the raw URI as a short link on a real reader card and copies through the native prompt", async () => {
        await wvT.withPref("weavero.enableAppLinks", true, () =>
            wvT.withPref("weavero.enableObsidianScheme", true, async () => {
                note.annotationComment = OBSIDIAN;
                await note.saveTx();
                const reader = await wvT.openReaderTab(pdf.id, 15000);
                assert.isOk(reader, "the PDF reader opened");
                const clipboard = Zotero.Utilities.Internal.copyTextToClipboard;
                let copied, promptTitle;
                const observer = {
                    observe(window, topic) {
                        if (topic !== "domwindowopened") return;
                        window.addEventListener("load", () => {
                            const d = window.document;
                            if (d.documentURI !== "chrome://global/content/commonDialog.xhtml") return;
                            const input = d.getElementById("loginTextbox");
                            if (!input) return;
                            promptTitle = d.title;
                            input.value = "Reader check";
                            d.getElementById("commonDialog").acceptDialog();
                        }, { once: true });
                    },
                };
                try {
                    reader._internalReader.toggleSidebar(true);
                    reader._internalReader.setSidebarView("annotations");
                    const readerDoc = reader._iframeWindow.document;
                    const card = () => readerDoc.querySelector('[data-sidebar-annotation-id="' + note.key + '"]');
                    const preview = await wvT.waitFor(() => card()?.querySelector(".wv-url-span.wv-link-app"), 12000);
                    assert.isOk(preview, "the comment preview rendered");
                    assert.equal(preview.textContent, "跳转到obsidian");
                    assert.equal(preview.getAttribute("data-href"), OBSIDIAN);
                    assert.equal(note.annotationComment, OBSIDIAN);

                    Services.ww.registerNotification(observer);
                    Zotero.Utilities.Internal.copyTextToClipboard = value => { copied = value; };
                    const more = card()?.querySelector("button.more");
                    assert.isOk(more, "the reader's annotation menu button exists");
                    more.click();
                    const entry = await wvT.waitFor(() => [
                        ...readerDoc.querySelectorAll(".context-menu button.row"),
                        ...reader._popupset.querySelectorAll("menuitem"),
                    ].find(el => (el.getAttribute("label") || el.textContent || "").trim() === MENU), 5000);
                    assert.isOk(entry, "the command reached the reader context menu");
                    if (entry.localName === "menuitem") entry.doCommand();
                    else entry.click();
                    await wvT.waitFor(() => copied, 5000);
                    assert.equal(promptTitle, MENU);
                    assert.equal(copied, "[Reader check](" + base + "?annotation=" + note.key + ")");
                } finally {
                    try { Services.ww.unregisterNotification(observer); } catch (e) {}
                    Zotero.Utilities.Internal.copyTextToClipboard = clipboard;
                    wvT.closeReaderTab(reader);
                }
            }));
    });
});
