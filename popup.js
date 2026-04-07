(() => {
  const STORAGE_KEY = "manuscriptTrackerData";
  const SETTINGS_KEY = "csAuthorToolsSettings";
  const summaryEl = document.getElementById("summary");
  const trackerEnabledEl = document.getElementById("trackerEnabled");
  const scholarEnabledEl = document.getElementById("scholarEnabled");
  const scholarCcfEnabledEl = document.getElementById("scholarCcfEnabled");
  const scholarSciEnabledEl = document.getElementById("scholarSciEnabled");
  const scholarIfEnabledEl = document.getElementById("scholarIfEnabled");
  const ifBucketSizeEl = document.getElementById("ifBucketSize");
  const listEl = document.getElementById("list");
  const exportBtn = document.getElementById("exportBtn");
  const importBtn = document.getElementById("importBtn");
  const importFileInput = document.getElementById("importFileInput");
  const clearBtn = document.getElementById("clearBtn");
  const itemTemplate = document.getElementById("itemTemplate");
  const tabButtons = Array.from(document.querySelectorAll(".tab-btn"));
  const tabPanels = Array.from(document.querySelectorAll(".tab-panel"));

  function formatTime(isoText) {
    if (!isoText) {
      return "-";
    }
    const d = new Date(isoText);
    if (Number.isNaN(d.getTime())) {
      return isoText;
    }
    return d.toLocaleString();
  }

  function safeObject(value) {
    return value && typeof value === "object" ? value : {};
  }

  function normalizeIfBucketSize(value) {
    const size = Number.parseInt(String(value), 10);
    if (!Number.isFinite(size) || size < 1) {
      return 5;
    }
    return Math.min(size, 100);
  }

  async function getStore() {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return normalizeStore(result[STORAGE_KEY]);
  }

  function normalizeStore(rawValue) {
    const raw = safeObject(rawValue);
    return {
      version: raw.version || 1,
      journals: safeObject(raw.journals)
    };
  }

  async function getSettings() {
    const result = await chrome.storage.local.get(SETTINGS_KEY);
    const raw = safeObject(result[SETTINGS_KEY]);
    return {
      manuscriptTrackerEnabled:
        typeof raw.manuscriptTrackerEnabled === "boolean" ? raw.manuscriptTrackerEnabled : true,
      scholarStatsEnabled:
        typeof raw.scholarStatsEnabled === "boolean" ? raw.scholarStatsEnabled : true,
      scholarCcfEnabled:
        typeof raw.scholarCcfEnabled === "boolean" ? raw.scholarCcfEnabled : true,
      scholarSciEnabled:
        typeof raw.scholarSciEnabled === "boolean" ? raw.scholarSciEnabled : true,
      scholarIfEnabled:
        typeof raw.scholarIfEnabled === "boolean" ? raw.scholarIfEnabled : true,
      ifBucketSize: normalizeIfBucketSize(raw.ifBucketSize)
    };
  }

  async function saveSettings(nextSettings) {
    const current = await getSettings();
    await chrome.storage.local.set({
      [SETTINGS_KEY]: {
        ...current,
        ...nextSettings
      }
    });
  }

  function getJournalCodes(store) {
    return Object.keys(store.journals).sort((a, b) => a.localeCompare(b));
  }

  function setSummary(store) {
    const journalCount = Object.keys(store.journals).length;
    const submissionCount = Object.values(store.journals).reduce((sum, journal) => {
      return sum + Object.keys(safeObject(journal.submissions)).length;
    }, 0);
    summaryEl.textContent = `已记录 ${journalCount} 个期刊, ${submissionCount} 个投稿主 ID`; 
  }

  function renderJournalItems(journal, container) {
    const submissions = safeObject(journal?.submissions);
    const items = Object.values(submissions).sort((a, b) => {
      const t1 = new Date(a.latestStatusAt || a.lastSeenAt || 0).getTime();
      const t2 = new Date(b.latestStatusAt || b.lastSeenAt || 0).getTime();
      return t2 - t1;
    });

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "该期刊暂无抓取记录。";
      container.appendChild(empty);
      return;
    }

    for (const item of items) {
      const node = itemTemplate.content.firstElementChild.cloneNode(true);
      const titleEl = node.querySelector(".item-title");
      const metaEl = node.querySelector(".meta");
      const statusEl = node.querySelector(".status");
      const historyEl = node.querySelector(".history");

      titleEl.textContent = item.titleLatest || item.baseId;
      metaEl.textContent = `主 ID: ${item.baseId} | 修订: ${(item.revisions || []).join(", ") || "-"}`;
      statusEl.innerHTML = `<strong>当前状态:</strong> ${item.latestStatus || "-"}<br><strong>状态更新时间:</strong> ${formatTime(item.latestStatusAt)}`;

        const history = compactHistoryForDisplay(item.history);
      if (history.length === 0) {
        const li = document.createElement("li");
        li.textContent = "无历史状态";
        historyEl.appendChild(li);
      } else {
        history.forEach((h) => {
          const li = document.createElement("li");
          li.textContent = `${formatTime(h.changedAt)} | ${h.status} | ${h.fullId}`;
          historyEl.appendChild(li);
        });
      }

      container.appendChild(node);
    }
  }

  function renderAllJournals(store, codes) {
    listEl.innerHTML = "";
    if (codes.length === 0) {
      listEl.innerHTML = '<div class="empty">打开期刊 Author Dashboard 后会自动开始记录。</div>';
      return;
    }

    for (const code of codes) {
      const block = document.createElement("section");
      block.className = "journal-block";

      const title = document.createElement("h2");
      title.className = "journal-title";
      const journal = store.journals[code] || {};
      const journalName = journal.journalName || "";
      title.textContent = journalName ? `期刊: ${journalName} (${code})` : `期刊: ${code}`;
      block.appendChild(title);

      renderJournalItems(journal, block);
      listEl.appendChild(block);
    }
  }

  function updateControlsByEnabled(enabled) {
    exportBtn.disabled = !enabled;
    importBtn.disabled = !enabled;
    clearBtn.disabled = !enabled;
  }

  function toTime(value) {
    const time = new Date(value || 0).getTime();
    return Number.isFinite(time) ? time : 0;
  }

  function uniqueStrings(values) {
    return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
  }

  function mergeHistory(existingHistory, importedHistory) {
    const merged = new Map();
    for (const item of [...(Array.isArray(existingHistory) ? existingHistory : []), ...(Array.isArray(importedHistory) ? importedHistory : [])]) {
      const key = `${item?.status || ""}||${item?.fullId || ""}||${item?.changedAt || ""}`;
      if (!merged.has(key)) {
        merged.set(key, item);
      }
    }
    return Array.from(merged.values()).sort((a, b) => toTime(a.changedAt) - toTime(b.changedAt));
  }

  function mergeSubmission(existingSubmission, importedSubmission) {
    const existing = safeObject(existingSubmission);
    const imported = safeObject(importedSubmission);
    const existingLatestTime = toTime(existing.latestStatusAt || existing.lastSeenAt);
    const importedLatestTime = toTime(imported.latestStatusAt || imported.lastSeenAt);
    const preferImported = importedLatestTime >= existingLatestTime;

    return {
      baseId: imported.baseId || existing.baseId || "",
      titleLatest: preferImported ? imported.titleLatest || existing.titleLatest || "" : existing.titleLatest || imported.titleLatest || "",
      firstSeenAt: existing.firstSeenAt || imported.firstSeenAt || "",
      lastSeenAt: preferImported ? imported.lastSeenAt || existing.lastSeenAt || "" : existing.lastSeenAt || imported.lastSeenAt || "",
      latestStatus: preferImported ? imported.latestStatus || existing.latestStatus || "" : existing.latestStatus || imported.latestStatus || "",
      latestStatusAt: preferImported ? imported.latestStatusAt || existing.latestStatusAt || "" : existing.latestStatusAt || imported.latestStatusAt || "",
      latestRecord: preferImported ? safeObject(imported.latestRecord) : safeObject(existing.latestRecord),
      revisions: uniqueStrings([...(existing.revisions || []), ...(imported.revisions || [])]),
      history: mergeHistory(existing.history, imported.history)
    };
  }

  function mergeStores(existingStore, importedStore) {
    const existing = normalizeStore(existingStore);
    const imported = normalizeStore(importedStore);
    const journalCodes = uniqueStrings([...Object.keys(existing.journals), ...Object.keys(imported.journals)]);
    const journals = {};

    for (const journalCode of journalCodes) {
      const existingJournal = safeObject(existing.journals[journalCode]);
      const importedJournal = safeObject(imported.journals[journalCode]);
      const submissionCodes = uniqueStrings([
        ...Object.keys(safeObject(existingJournal.submissions)),
        ...Object.keys(safeObject(importedJournal.submissions))
      ]);

      const submissions = {};
      for (const submissionCode of submissionCodes) {
        submissions[submissionCode] = mergeSubmission(
          safeObject(existingJournal.submissions)?.[submissionCode],
          safeObject(importedJournal.submissions)?.[submissionCode]
        );
      }

      journals[journalCode] = {
        journalCode,
        journalName: importedJournal.journalName || existingJournal.journalName || "",
        firstSeenAt: existingJournal.firstSeenAt || importedJournal.firstSeenAt || "",
        lastSeenAt:
          toTime(importedJournal.lastSeenAt) >= toTime(existingJournal.lastSeenAt)
            ? importedJournal.lastSeenAt || existingJournal.lastSeenAt || ""
            : existingJournal.lastSeenAt || importedJournal.lastSeenAt || "",
        submissions
      };
    }

    return {
      version: Math.max(existing.version || 1, imported.version || 1),
      journals
    };
  }

  function activateTab(tabId) {
    tabButtons.forEach((btn) => {
      const active = btn.dataset.tab === tabId;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", String(active));
    });

    tabPanels.forEach((panel) => {
      const active = panel.id === tabId;
      panel.classList.toggle("active", active);
      panel.setAttribute("aria-hidden", String(!active));
    });
  }
  
    function compactHistoryForDisplay(history) {
      const latestByKey = new Map();
      for (const item of Array.isArray(history) ? history : []) {
        const key = `${item.status || ""}||${item.fullId || ""}`;
        const prev = latestByKey.get(key);
        const t = new Date(item.changedAt || 0).getTime();
        const prevT = prev ? new Date(prev.changedAt || 0).getTime() : -1;
        if (!prev || t >= prevT) {
          latestByKey.set(key, item);
        }
      }
      return Array.from(latestByKey.values()).sort((a, b) => {
        const t1 = new Date(a.changedAt || 0).getTime();
        const t2 = new Date(b.changedAt || 0).getTime();
        return t2 - t1;
      });
    }

  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function refresh() {
    const [store, settings] = await Promise.all([getStore(), getSettings()]);
    setSummary(store);
    const codes = getJournalCodes(store);
    trackerEnabledEl.checked = settings.manuscriptTrackerEnabled;
    if (scholarEnabledEl) {
      scholarEnabledEl.checked = settings.scholarStatsEnabled;
    }
    if (scholarCcfEnabledEl) {
      scholarCcfEnabledEl.checked = settings.scholarCcfEnabled;
      scholarCcfEnabledEl.disabled = !settings.scholarStatsEnabled;
    }
    if (scholarSciEnabledEl) {
      scholarSciEnabledEl.checked = settings.scholarSciEnabled;
      scholarSciEnabledEl.disabled = !settings.scholarStatsEnabled;
    }
    if (scholarIfEnabledEl) {
      scholarIfEnabledEl.checked = settings.scholarIfEnabled;
      scholarIfEnabledEl.disabled = !settings.scholarStatsEnabled;
    }
    if (ifBucketSizeEl) {
      ifBucketSizeEl.value = String(settings.ifBucketSize);
      ifBucketSizeEl.disabled = !settings.scholarStatsEnabled || !settings.scholarIfEnabled;
    }
    updateControlsByEnabled(settings.manuscriptTrackerEnabled);

    if (settings.manuscriptTrackerEnabled) {
      renderAllJournals(store, codes);
    } else {
      listEl.innerHTML = '<div class="empty">投稿状态记录功能已关闭，开启后会继续自动抓取。</div>';
    }
  }

  trackerEnabledEl.addEventListener("change", async () => {
    const enabled = trackerEnabledEl.checked;
    await saveSettings({ manuscriptTrackerEnabled: enabled });
    await refresh();
  });

  if (scholarEnabledEl) {
    scholarEnabledEl.addEventListener("change", async () => {
      const enabled = scholarEnabledEl.checked;
      await saveSettings({ scholarStatsEnabled: enabled });
      await refresh();
    });
  }

  if (scholarCcfEnabledEl) {
    scholarCcfEnabledEl.addEventListener("change", async () => {
      await saveSettings({ scholarCcfEnabled: scholarCcfEnabledEl.checked });
    });
  }

  if (scholarSciEnabledEl) {
    scholarSciEnabledEl.addEventListener("change", async () => {
      await saveSettings({ scholarSciEnabled: scholarSciEnabledEl.checked });
      await refresh();
    });
  }

  if (scholarIfEnabledEl) {
    scholarIfEnabledEl.addEventListener("change", async () => {
      await saveSettings({ scholarIfEnabled: scholarIfEnabledEl.checked });
      await refresh();
    });
  }

  if (ifBucketSizeEl) {
    ifBucketSizeEl.addEventListener("change", async () => {
      const value = normalizeIfBucketSize(ifBucketSizeEl.value);
      ifBucketSizeEl.value = String(value);
      await saveSettings({ ifBucketSize: value });
    });
  }

  exportBtn.addEventListener("click", async () => {
    const store = await getStore();
    const ts = new Date().toISOString().replace(/[.:]/g, "-");
    downloadJson(`manuscript-tracker-${ts}.json`, store);
  });

  importBtn.addEventListener("click", () => {
    importFileInput.value = "";
    importFileInput.click();
  });

  importFileInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const imported = JSON.parse(text);
      const current = await getStore();
      const merged = mergeStores(current, imported);
      await chrome.storage.local.set({ [STORAGE_KEY]: merged });
      await refresh();
      alert("投稿状态记录已成功导入并合并。");
    } catch (error) {
      console.error("[CS Author Tools] import failed", error);
      alert("导入失败，请确认选择的是有效的 JSON 导出文件。");
    }
  });

  clearBtn.addEventListener("click", async () => {
    const ok = confirm("确认清空所有已记录的投稿状态吗?");
    if (!ok) {
      return;
    }
    await chrome.storage.local.remove(STORAGE_KEY);
    await refresh();
  });

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      activateTab(btn.dataset.tab);
    });
  });

  refresh();
})();
