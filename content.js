(() => {
  const STORAGE_KEY = "manuscriptTrackerData";
  const SETTINGS_KEY = "csAuthorToolsSettings";
  const SNAPSHOT_DELAYS_MS = [0, 1500, 4000];
  const MAX_HISTORY_PER_SUBMISSION = 200;

  function normalizeText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function getJournalCode() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    return parts[0] || "unknown-journal";
  }

  function getJournalName() {
    const exact = document.querySelector("a.brand.visible-tablet.visible-phone");
    const fallback = document.querySelector("a.brand");
    return normalizeText((exact || fallback)?.textContent) || "";
  }

  function isAuthorDashboard() {
    const navHeaders = Array.from(document.querySelectorAll("li.nav-header"));
    const hasAuthorHeader = navHeaders.some((el) => normalizeText(el.textContent) === "Author Dashboard");
    if (hasAuthorHeader) {
      return true;
    }

    const currentPage = document.querySelector('input[name="CURRENT_PAGE"]');
    return normalizeText(currentPage?.value).toUpperCase() === "AUTHOR_VIEW_MANUSCRIPTS";
  }

  function getTableRows() {
    return Array.from(document.querySelectorAll("#authorDashboardQueue tbody tr"));
  }

  function extractIdToken(rawId) {
    const compact = normalizeText(rawId);
    const firstPart = compact.split("(")[0].trim();
    const match = firstPart.match(/[A-Za-z0-9]+-\d{4}-\d+(?:\.R\d+)?/i);
    if (match) {
      return match[0].toUpperCase();
    }
    return firstPart.toUpperCase();
  }

  function toBaseSubmissionId(idToken) {
    return idToken.replace(/\.R\d+$/i, "");
  }

  function getRevisionNumber(fullId) {
    const match = (fullId || "").match(/\.R(\d+)$/i);
    return match ? Number(match[1]) : 0;
  }

  function parseDateText(dateText) {
    const text = normalizeText(dateText);
    const m = text.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
    if (!m) {
      return 0;
    }

    const monthMap = {
      Jan: 0,
      Feb: 1,
      Mar: 2,
      Apr: 3,
      May: 4,
      Jun: 5,
      Jul: 6,
      Aug: 7,
      Sep: 8,
      Oct: 9,
      Nov: 10,
      Dec: 11
    };

    const monthIndex = monthMap[m[2]];
    if (monthIndex === undefined) {
      return 0;
    }
    return Date.UTC(Number(m[3]), monthIndex, Number(m[1]));
  }

  function shouldReplaceRepresentative(previous, next) {
    const prevRev = getRevisionNumber(previous.fullId);
    const nextRev = getRevisionNumber(next.fullId);
    if (nextRev !== prevRev) {
      return nextRev > prevRev;
    }

    const prevSubmitted = parseDateText(previous.submitted);
    const nextSubmitted = parseDateText(next.submitted);
    if (nextSubmitted !== prevSubmitted) {
      return nextSubmitted > prevSubmitted;
    }

    const prevCreated = parseDateText(previous.created);
    const nextCreated = parseDateText(next.created);
    return nextCreated > prevCreated;
  }

  function aggregateEntriesByBaseId(entries) {
    const grouped = new Map();

    for (const entry of entries) {
      const key = entry.baseId;
      if (!grouped.has(key)) {
        grouped.set(key, {
          representative: entry,
          revisions: new Set([entry.fullId])
        });
        continue;
      }

      const current = grouped.get(key);
      current.revisions.add(entry.fullId);
      if (shouldReplaceRepresentative(current.representative, entry)) {
        current.representative = entry;
      }
    }

    return Array.from(grouped.values()).map((g) => ({
      ...g.representative,
      revisions: Array.from(g.revisions)
    }));
  }

  function groupAllEntriesByBaseId(entries) {
    const grouped = new Map();
    for (const entry of entries) {
      if (!grouped.has(entry.baseId)) {
        grouped.set(entry.baseId, []);
      }
      grouped.get(entry.baseId).push(entry);
    }
    return grouped;
  }

  async function isFeatureEnabled() {
    const raw = await chrome.storage.local.get(SETTINGS_KEY);
    const settings = raw[SETTINGS_KEY] && typeof raw[SETTINGS_KEY] === "object" ? raw[SETTINGS_KEY] : {};
    if (typeof settings.manuscriptTrackerEnabled === "boolean") {
      return settings.manuscriptTrackerEnabled;
    }
    return true;
  }

  function extractStatusText(statusCell) {
    if (!statusCell) {
      return "Unknown";
    }

    const detailed = Array.from(statusCell.querySelectorAll(".pagecontents"))
      .map((el) => normalizeText(el.textContent))
      .filter(Boolean);

    if (detailed.length > 0) {
      return detailed.join(" | ");
    }

    return normalizeText(statusCell.textContent) || "Unknown";
  }

  function extractTitleText(titleCell) {
    if (!titleCell) {
      return "";
    }

    const cloned = titleCell.cloneNode(true);
    cloned.querySelectorAll("a").forEach((a) => a.remove());
    return normalizeText(cloned.textContent);
  }

  function parseRows() {
    const rows = getTableRows();
    const nowIso = new Date().toISOString();

    return rows
      .map((row) => {
        const statusCell = row.querySelector('td[data-label="status"]');
        const idCell = row.querySelector('td[data-label="ID"]');
        const titleCell = row.querySelector('td[data-label="title"]');
        const createdCell = row.querySelector('td[data-label="created"]');
        const submittedCell = row.querySelector('td[data-label="submitted"]');

        const rawId = normalizeText(idCell?.textContent);
        const idToken = extractIdToken(rawId);
        const baseId = toBaseSubmissionId(idToken);

        if (!baseId) {
          return null;
        }

        return {
          baseId,
          fullId: idToken,
          rawId,
          status: extractStatusText(statusCell),
          title: extractTitleText(titleCell),
          created: normalizeText(createdCell?.textContent),
          submitted: normalizeText(submittedCell?.textContent),
          scrapedAt: nowIso
        };
      })
      .filter(Boolean);
  }

  function ensureStoreShape(data) {
    const base = data && typeof data === "object" ? data : {};
    if (!base.version) {
      base.version = 1;
    }
    if (!base.journals || typeof base.journals !== "object") {
      base.journals = {};
    }
    return base;
  }

  function mergeSnapshot(store, journalCode, journalName, entries) {
    const nowIso = new Date().toISOString();
    const groupedEntries = groupAllEntriesByBaseId(entries);

    if (!store.journals[journalCode]) {
      store.journals[journalCode] = {
        journalCode,
        journalName: journalName || "",
        firstSeenAt: nowIso,
        lastSeenAt: nowIso,
        submissions: {}
      };
    }

    const journal = store.journals[journalCode];
    journal.lastSeenAt = nowIso;
    if (journalName) {
      journal.journalName = journalName;
    }

    for (const [baseId, baseEntries] of groupedEntries.entries()) {
      const representative = aggregateEntriesByBaseId(baseEntries)[0] || baseEntries[0];
      const key = baseId;
      if (!journal.submissions[key]) {
        journal.submissions[key] = {
          baseId,
          titleLatest: representative.title,
          firstSeenAt: nowIso,
          lastSeenAt: nowIso,
          latestStatus: representative.status,
          latestStatusAt: nowIso,
          latestRecord: representative,
          revisions: [],
          history: []
        };
      }

      const submission = journal.submissions[key];
      submission.lastSeenAt = nowIso;
      submission.titleLatest = representative.title || submission.titleLatest;
      submission.latestRecord = representative;

      const knownHistoryKeys = new Set(
        (submission.history || []).map((h) => `${h.fullId || ""}||${h.status || ""}`)
      );
      const seenInThisSnapshot = new Set();

      for (const rowEntry of baseEntries) {
        const rowKey = `${rowEntry.fullId || ""}||${rowEntry.status || ""}`;
        if (seenInThisSnapshot.has(rowKey)) {
          continue;
        }
        seenInThisSnapshot.add(rowKey);

        if (!knownHistoryKeys.has(rowKey)) {
          submission.history.push({
            status: rowEntry.status,
            changedAt: nowIso,
            fullId: rowEntry.fullId,
            rawId: rowEntry.rawId
          });
          knownHistoryKeys.add(rowKey);
        }

        if (!submission.revisions.includes(rowEntry.fullId)) {
          submission.revisions.push(rowEntry.fullId);
        }
      }

      const previousStatus = submission.latestStatus;
      const statusChanged = previousStatus !== representative.status;

      if (submission.history.length > MAX_HISTORY_PER_SUBMISSION) {
        submission.history.splice(0, submission.history.length - MAX_HISTORY_PER_SUBMISSION);
      }

      submission.latestStatus = representative.status;
      if (statusChanged || !submission.latestStatusAt) {
        submission.latestStatusAt = nowIso;
      }
    }

    return store;
  }

  let mergeInFlight = false;

  async function captureAndStore(reason) {
    if (mergeInFlight) {
      return;
    }

    if (!(await isFeatureEnabled())) {
      return;
    }

    if (!isAuthorDashboard()) {
      return;
    }

    const entries = parseRows();
    if (entries.length === 0) {
      return;
    }

    mergeInFlight = true;
    try {
      const journalCode = getJournalCode();
      const journalName = getJournalName();
      const current = await chrome.storage.local.get(STORAGE_KEY);
      const store = ensureStoreShape(current[STORAGE_KEY]);
      const merged = mergeSnapshot(store, journalCode, journalName, entries);

      await chrome.storage.local.set({
        [STORAGE_KEY]: merged,
        csAuthorToolsLastCapture: {
          journalCode,
          journalName,
          count: aggregateEntriesByBaseId(entries).length,
          reason,
          capturedAt: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error("[ManuscriptTracker] capture failed", error);
    } finally {
      mergeInFlight = false;
    }
  }

  function installObserver() {
    const table = document.querySelector("#authorDashboardQueue");
    if (!table) {
      return;
    }

    let timer = null;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        captureAndStore("mutation");
      }, 300);
    });

    observer.observe(table, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function runStartupSnapshots() {
    SNAPSHOT_DELAYS_MS.forEach((delay) => {
      setTimeout(() => {
        captureAndStore(`startup-${delay}`);
      }, delay);
    });
  }

  runStartupSnapshots();
  installObserver();
})();
