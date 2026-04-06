(() => {
  const SETTINGS_KEY = "csAuthorToolsSettings";
  const PANEL_ID = "csat-scholar-stats";
  const STYLE_ID = "csat-scholar-style";
  const AUTHOR_HIGHLIGHT_CLASS = "csat-current-author-name";

  function normalizeText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
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

  async function getFeatureSettings() {
    const raw = await chrome.storage.local.get(SETTINGS_KEY);
    const settings = raw[SETTINGS_KEY] && typeof raw[SETTINGS_KEY] === "object" ? raw[SETTINGS_KEY] : {};
    return {
      scholarStatsEnabled:
        typeof settings.scholarStatsEnabled === "boolean" ? settings.scholarStatsEnabled : true,
      scholarCcfEnabled:
        typeof settings.scholarCcfEnabled === "boolean" ? settings.scholarCcfEnabled : true
    };
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

    clearHighlights();

    rows.forEach((row) => {
      const authorsDiv = row.querySelector("td.gsc_a_t .gs_gray");
      const authorsText = normalizeText(authorsDiv?.textContent || "");
      const matchedAuthor = findMatchedAuthor(authorsText, profileName);
      const rowCcfRanks = collectCcfRanks(row);

      if (settings.scholarCcfEnabled) {
        rowCcfRanks.forEach((rank) => {
          if (rank in ccfCounts) {
            ccfCounts[rank] += 1;
          }
        });
      }

      if (matchedAuthor) {
        row.classList.add("csat-current-author-row");
        highlightAuthorToken(authorsDiv, matchedAuthor.token);
        if (matchedAuthor.isFirstAuthor) {
          firstAuthorCount += 1;
        }
      }
    });

    const panel = ensureStatsPanel(citedBlock);
    const ccfRows = settings.scholarCcfEnabled
      ? `
      <div class="csat-row"><span class="csat-label">CCF A</span><span class="csat-value">${ccfCounts["CCF A"]}</span></div>
      <div class="csat-row"><span class="csat-label">CCF B</span><span class="csat-value">${ccfCounts["CCF B"]}</span></div>
      <div class="csat-row"><span class="csat-label">CCF C</span><span class="csat-value">${ccfCounts["CCF C"]}</span></div>`
      : "";
    panel.innerHTML = `
      <div class="csat-row"><span class="csat-label">Total Publications</span><span class="csat-value">${rows.length}</span></div>
      <div class="csat-row"><span class="csat-label">First-Author Publications</span><span class="csat-value">${firstAuthorCount}</span></div>
      ${ccfRows}
    `;
  }

  function setupObservers() {
    const tableBody = document.getElementById("gsc_a_b");
    if (!tableBody) {
      return;
    }

    let timer = null;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        renderStats(await getFeatureSettings());
      }, 200);
    });

    observer.observe(tableBody, { childList: true, subtree: true, characterData: true });

    const moreBtn = document.getElementById("gsc_bpf_more");
    if (moreBtn) {
      moreBtn.addEventListener("click", () => {
        setTimeout(async () => {
          renderStats(await getFeatureSettings());
        }, 800);
      });
    }
  }

  async function main() {
    const settings = await getFeatureSettings();
    if (!settings.scholarStatsEnabled) {
      return;
    }

    renderStats(settings);
    setTimeout(async () => {
      renderStats(await getFeatureSettings());
    }, 1000);
    setTimeout(async () => {
      renderStats(await getFeatureSettings());
    }, 2500);
    setupObservers();
  }

  main();
})();
