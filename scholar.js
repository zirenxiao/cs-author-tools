(() => {
  const SETTINGS_KEY = "csAuthorToolsSettings";
  const PANEL_ID = "csat-scholar-stats";
  const STYLE_ID = "csat-scholar-style";
  const AUTHOR_HIGHLIGHT_CLASS = "csat-current-author-name";
  const DEFAULT_SETTINGS = {
    scholarStatsEnabled: true,
    scholarCcfEnabled: true,
    scholarSciEnabled: true,
    scholarIfEnabled: true,
    ifBucketSize: 5
  };

  function hasUsableExtensionStorage() {
    return Boolean(globalThis.chrome?.runtime?.id && globalThis.chrome?.storage?.local?.get);
  }

  function normalizeText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function normalizeIfBucketSize(value) {
    const size = Number.parseInt(String(value), 10);
    if (!Number.isFinite(size) || size < 1) {
      return DEFAULT_SETTINGS.ifBucketSize;
    }
    return Math.min(size, 100);
  }

  function normalizeName(value) {
    return normalizeText(value).toLowerCase().replace(/[^a-z\u4e00-\u9fff\s]/g, " ").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getProfileMatcher(profileName) {
    const normalized = normalizeName(profileName);
    const tokens = normalized.split(" ").filter(Boolean);
    const firstName = tokens[0] || "";
    const lastName = tokens[tokens.length - 1] || "";
    const givenNameTokens = tokens.slice(0, -1);
    const initials = givenNameTokens.map((token) => token[0]).join("").trim();
    return {
      normalized,
      firstName,
      lastName,
      firstInitial: firstName ? firstName[0] : "",
      initials,
      compactName: `${tokens.join("")}`,
      compactGivenNames: givenNameTokens.join("")
    };
  }

  function splitAuthors(authorsText) {
    return normalizeText(authorsText)
      .split(/,|;|\band\b/i)
      .map((part) => normalizeText(part))
      .filter(Boolean);
  }

  function isAuthorTokenMatch(authorToken, profileMatcher) {
    const token = normalizeName(authorToken);
    if (!token || !profileMatcher.normalized) {
      return false;
    }

    if (token === profileMatcher.normalized) {
      return true;
    }

    const tokenParts = token.split(" ").filter(Boolean);
    if (tokenParts.length < 2) {
      return false;
    }

    const tokenFirst = tokenParts.slice(0, -1).join("");
    const tokenLast = tokenParts[tokenParts.length - 1];
    if (tokenLast !== profileMatcher.lastName) {
      return false;
    }

    if (token === profileMatcher.normalized) {
      return true;
    }

    if (tokenFirst === profileMatcher.firstName) {
      return true;
    }

    if (tokenFirst === profileMatcher.firstInitial) {
      return true;
    }

    if (tokenFirst === profileMatcher.initials) {
      return true;
    }

    if (tokenFirst === profileMatcher.compactGivenNames) {
      return true;
    }

    return token.replace(/\s+/g, "") === profileMatcher.compactName;
  }

  function findMatchedAuthor(authorsText, profileName) {
    const profileMatcher = getProfileMatcher(profileName);
    const authors = splitAuthors(authorsText);
    for (let index = 0; index < authors.length; index += 1) {
      if (isAuthorTokenMatch(authors[index], profileMatcher)) {
        return {
          token: authors[index],
          isFirstAuthor: index === 0
        };
      }
    }
    return null;
  }

  function restoreAuthorText(authorsDiv) {
    if (!authorsDiv) {
      return;
    }

    const original = authorsDiv.dataset.csatOriginalAuthors;
    if (original) {
      authorsDiv.textContent = original;
    }
  }

  function highlightAuthorToken(authorsDiv, matchedToken) {
    if (!authorsDiv || !matchedToken) {
      return;
    }

    const sourceText = authorsDiv.dataset.csatOriginalAuthors || normalizeText(authorsDiv.textContent || "");
    authorsDiv.dataset.csatOriginalAuthors = sourceText;

    const authors = splitAuthors(sourceText);
    const html = authors
      .map((token) => {
        if (token === matchedToken) {
          return `<span class="${AUTHOR_HIGHLIGHT_CLASS}">${escapeHtml(token)}</span>`;
        }
        return escapeHtml(token);
      })
      .join(", ");

    authorsDiv.innerHTML = html;
  }

  function collectCcfRanks(row) {
    return Array.from(row.querySelectorAll(".easyscholar-ranking"))
      .map((el) => normalizeText(el.textContent))
      .filter((text) => /^CCF\s+/i.test(text));
  }

  function collectSciQuartiles(row) {
    if (!row) {
      return [];
    }

    return Array.from(row.querySelectorAll(".easyscholar-ranking"))
      .map((el) => normalizeText(el.textContent))
      .filter((text) => /^SCI\s+Q[1-4]$/i.test(String(text || "")));
  }

  function collectIfScores(row) {
    if (!row) {
      return [];
    }

    return Array.from(row.querySelectorAll(".easyscholar-ranking"))
      .map((el) => normalizeText(el.textContent))
      .map((text) => {
        const match = String(text || "").match(/^IF\s+([0-9]+(?:\.[0-9]+)?)$/i);
        return match ? Number(match[1]) : null;
      })
      .filter((value) => Number.isFinite(value));
  }

  function getIfBucketLabel(score, bucketSize) {
    const size = normalizeIfBucketSize(bucketSize);
    const start = Math.floor(score / size) * size;
    const end = start + size;
    return `${start}~${end}`;
  }

  async function getFeatureSettings() {
    if (!hasUsableExtensionStorage()) {
      return { ...DEFAULT_SETTINGS };
    }

    try {
      const raw = await globalThis.chrome.storage.local.get(SETTINGS_KEY);
      const settings = raw && raw[SETTINGS_KEY] && typeof raw[SETTINGS_KEY] === "object" ? raw[SETTINGS_KEY] : {};
      return {
        scholarStatsEnabled:
          typeof settings.scholarStatsEnabled === "boolean"
            ? settings.scholarStatsEnabled
            : DEFAULT_SETTINGS.scholarStatsEnabled,
        scholarCcfEnabled:
          typeof settings.scholarCcfEnabled === "boolean"
            ? settings.scholarCcfEnabled
            : DEFAULT_SETTINGS.scholarCcfEnabled,
        scholarSciEnabled:
          typeof settings.scholarSciEnabled === "boolean"
            ? settings.scholarSciEnabled
            : DEFAULT_SETTINGS.scholarSciEnabled,
        scholarIfEnabled:
          typeof settings.scholarIfEnabled === "boolean"
            ? settings.scholarIfEnabled
            : DEFAULT_SETTINGS.scholarIfEnabled,
        ifBucketSize: normalizeIfBucketSize(settings.ifBucketSize)
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function getProfileName() {
    return normalizeText(document.querySelector("#gsc_prf_in")?.textContent || "");
  }

  function getPublicationRows() {
    return Array.from(document.querySelectorAll("#gsc_a_b tr.gsc_a_tr"));
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        margin-top: 12px;
        border-top: 1px solid #eee;
        padding-top: 10px;
      }
      #${PANEL_ID} .csat-row {
        display: flex;
        justify-content: space-between;
        font-size: 13px;
        color: #444;
        padding: 2px 0;
      }
      #${PANEL_ID} .csat-label {
        color: #5f6368;
      }
      #${PANEL_ID} .csat-value {
        font-weight: 600;
        color: #202124;
      }
      .csat-current-author-row {
        box-shadow: inset 3px 0 0 #1a73e8;
        background: #f7fbff;
      }
      .${AUTHOR_HIGHLIGHT_CLASS} {
        display: inline-block;
        padding: 0 4px;
        border-radius: 999px;
        background: #d2e3fc;
        color: #174ea6;
        font-weight: 600;
      }
    `;

    document.head.appendChild(style);
  }

  function ensureStatsPanel(container) {
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = PANEL_ID;
      container.appendChild(panel);
    }
    return panel;
  }

  function clearHighlights() {
    document.querySelectorAll(".csat-current-author-row").forEach((el) => {
      el.classList.remove("csat-current-author-row");
    });

    document.querySelectorAll("td.gsc_a_t .gs_gray").forEach((el) => {
      restoreAuthorText(el);
    });
  }

  function renderStats(settings) {
    const citedBlock = document.getElementById("gsc_rsb_cit");
    if (!citedBlock) {
      return;
    }

    injectStyle();

    const profileName = getProfileName();
    const rows = getPublicationRows();
    let firstAuthorCount = 0;
    const ccfCounts = {
      "CCF A": 0,
      "CCF B": 0,
      "CCF C": 0
    };
    const ccfFirstAuthorCounts = {
      "CCF A": 0,
      "CCF B": 0,
      "CCF C": 0
    };
    const sciCounts = {
      "SCI Q1": 0,
      "SCI Q2": 0,
      "SCI Q3": 0,
      "SCI Q4": 0
    };
    const ifBucketCounts = new Map();
    const ifBucketSize = normalizeIfBucketSize(settings.ifBucketSize);

    clearHighlights();

    rows.forEach((row) => {
      const authorsDiv = row.querySelector("td.gsc_a_t .gs_gray");
      const authorsText = normalizeText(authorsDiv?.textContent || "");
      const matchedAuthor = findMatchedAuthor(authorsText, profileName);
      const rowCcfRanks = Array.from(new Set(collectCcfRanks(row).map((rank) => rank.toUpperCase())));
      const rowSciQuartiles = settings.scholarSciEnabled
        ? Array.from(new Set(collectSciQuartiles(row).map((rank) => rank.toUpperCase())))
        : [];
      const rowIfScores = settings.scholarIfEnabled ? collectIfScores(row) : [];

      if (settings.scholarCcfEnabled) {
        rowCcfRanks.forEach((rank) => {
          if (rank in ccfCounts) {
            ccfCounts[rank] += 1;
          }
        });
      }

      if (settings.scholarSciEnabled) {
        rowSciQuartiles.forEach((quartile) => {
          if (quartile in sciCounts) {
            sciCounts[quartile] += 1;
          }
        });
      }

      if (settings.scholarIfEnabled) {
        rowIfScores.forEach((score) => {
          const bucket = getIfBucketLabel(score, ifBucketSize);
          ifBucketCounts.set(bucket, (ifBucketCounts.get(bucket) || 0) + 1);
        });
      }

      if (matchedAuthor) {
        row.classList.add("csat-current-author-row");
        highlightAuthorToken(authorsDiv, matchedAuthor.token);
        if (matchedAuthor.isFirstAuthor) {
          firstAuthorCount += 1;
          if (settings.scholarCcfEnabled) {
            rowCcfRanks.forEach((rank) => {
              if (rank in ccfFirstAuthorCounts) {
                ccfFirstAuthorCounts[rank] += 1;
              }
            });
          }
        }
      }
    });

    const panel = ensureStatsPanel(citedBlock);
    const ccfRows = settings.scholarCcfEnabled
      ? `
      <div class="csat-row"><span class="csat-label">CCF A (一作)</span><span class="csat-value">${ccfCounts["CCF A"]} (${ccfFirstAuthorCounts["CCF A"]})</span></div>
      <div class="csat-row"><span class="csat-label">CCF B (一作)</span><span class="csat-value">${ccfCounts["CCF B"]} (${ccfFirstAuthorCounts["CCF B"]})</span></div>
      <div class="csat-row"><span class="csat-label">CCF C (一作)</span><span class="csat-value">${ccfCounts["CCF C"]} (${ccfFirstAuthorCounts["CCF C"]})</span></div>`
      : "";
    const sciRows = settings.scholarSciEnabled
      ? Object.keys(sciCounts)
          .map((key) => `<div class="csat-row"><span class="csat-label">${key}</span><span class="csat-value">${sciCounts[key]}</span></div>`)
          .join("")
      : "";
    const ifRows = settings.scholarIfEnabled
      ? Array.from(ifBucketCounts.entries())
          .sort((a, b) => Number(a[0].split("~")[0]) - Number(b[0].split("~")[0]))
          .map(([bucket, count]) => `<div class="csat-row"><span class="csat-label">IF ${bucket}</span><span class="csat-value">${count}</span></div>`)
          .join("")
      : "";
    panel.innerHTML = `
      <div class="csat-row"><span class="csat-label">Total Publications</span><span class="csat-value">${rows.length}</span></div>
      <div class="csat-row"><span class="csat-label">First-Author Publications</span><span class="csat-value">${firstAuthorCount}</span></div>
      ${ccfRows}
      ${sciRows}
      ${ifRows}
    `;
  }

  async function safeRenderStats() {
    try {
      const settings = await getFeatureSettings();
      if (!settings.scholarStatsEnabled) {
        return;
      }
      renderStats(settings);
    } catch {
      // Keep content script resilient to transient DOM/storage/runtime errors.
    }
  }

  function setupObservers() {
    const tableBody = document.getElementById("gsc_a_b");
    if (!tableBody) {
      return;
    }

    let timer = null;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        safeRenderStats();
      }, 200);
    });

    observer.observe(tableBody, { childList: true, subtree: true, characterData: true });

    const moreBtn = document.getElementById("gsc_bpf_more");
    if (moreBtn) {
      moreBtn.addEventListener("click", () => {
        setTimeout(() => {
          safeRenderStats();
        }, 800);
      });
    }
  }

  async function main() {
    await safeRenderStats();
    setTimeout(() => {
      safeRenderStats();
    }, 1000);
    setTimeout(() => {
      safeRenderStats();
    }, 2500);
    setupObservers();
  }

  main();
})();
