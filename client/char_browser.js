// Character browser — a collapsible bottom-left panel that lists all
// user-added Nôm characters with search + filters. Clicking a tile
// navigates the editor to that character.

Session.setDefault("browser.entries", []);
Session.setDefault("browser.search", "");
Session.setDefault("browser.filter", "nom");
Session.setDefault("browser.collapsed", false);

const loadBrowserEntries = () => {
  Meteor.call("getUserAddedNomBrowserList", (err, data) => {
    if (err) {
      console.error("char browser: failed to load", err);
      return;
    }
    Session.set("browser.entries", data || []);
  });
};

const codepointLabel = (cp) =>
  `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;

const normalize = (s) => (s || "").trim().toLowerCase();

const parseCodepointQuery = (q) => {
  const m = q.toLowerCase().match(/^(u\+|0x)?([0-9a-f]{2,6})$/);
  if (!m) return null;
  const cp = parseInt(m[2], 16);
  return Number.isFinite(cp) ? cp : null;
};

const applyFilters = (raw, filter, search) => {
  // By default (any filter other than "components" or "all"), components
  // are hidden — they're authoring aids, not characters the user wants to
  // browse as part of their Nôm set.
  const entries = raw.filter((e) => {
    if (filter !== "components" && filter !== "all" && e.componentOnly) return false;
    if (filter === "issues" && !e.hasPartialMedians) return false;
    if (filter === "incomplete" && e.hasCompleteOrder) return false;
    if (filter === "components" && !e.componentOnly) return false;
    return true;
  });
  if (!search) return entries;
  // Codepoint search — exact or prefix match on hex.
  const asCp = parseCodepointQuery(search);
  if (asCp != null) {
    return entries.filter((e) => e.codepoint === asCp);
  }
  // Otherwise: substring match on character (handles typed Nôm chars).
  return entries.filter((e) => e.character.indexOf(search) >= 0);
};

Template.char_browser.helpers({
  collapsed: () => Session.get("browser.collapsed"),
  stateClass: () => (Session.get("browser.collapsed") ? "collapsed" : ""),
  toggleLabel: () => (Session.get("browser.collapsed") ? "▲" : "▼"),
  search: () => Session.get("browser.search"),
  filter: () => Session.get("browser.filter"),
  totalCount: () => (Session.get("browser.entries") || []).length,
  entries: () => {
    const raw = Session.get("browser.entries") || [];
    const filter = Session.get("browser.filter");
    const search = Session.get("browser.search");
    return applyFilters(raw, filter, search).map((e) => ({
      ...e,
      codepointLabel: codepointLabel(e.codepoint),
      statusClass:
        (e.componentOnly ? "component " : "") +
        (e.hasPartialMedians
          ? "issues"
          : !e.hasCompleteOrder
            ? "incomplete"
            : "done"),
    }));
  },
  filteredCount: () => {
    const raw = Session.get("browser.entries") || [];
    const filter = Session.get("browser.filter");
    const search = Session.get("browser.search");
    return applyFilters(raw, filter, search).length;
  },
});

Template.char_browser.events({
  "click .cb-toggle": function () {
    Session.set("browser.collapsed", !Session.get("browser.collapsed"));
  },
  "click .cb-refresh": function () {
    loadBrowserEntries();
  },
  "input .cb-search": function (event) {
    Session.set("browser.search", event.target.value);
  },
  "change .cb-filter": function (event) {
    Session.set("browser.filter", event.target.value);
  },
  "click .cb-item": function (event) {
    event.preventDefault();
    const ch = event.currentTarget.getAttribute("data-char");
    if (ch) window.location.hash = encodeURIComponent(ch);
  },
});

Meteor.startup(() => {
  loadBrowserEntries();
  // Refresh whenever editor.js signals a successful save.
  Tracker.autorun(() => {
    const ts = Session.get("browser.savedAt");
    if (!ts) return;
    loadBrowserEntries();
  });
});

export { loadBrowserEntries };
