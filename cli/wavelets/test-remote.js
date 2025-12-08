const root = UI.column({
  children: [
    UI.text({ label: "Test Remote" }),
    UI.button({ label: "Power", onTap: () => IR.send("power") }),
    UI.button({ label: "Vol+", onTap: () => IR.send("vol_up") }),
    UI.button({ label: "Vol-", onTap: () => IR.send("vol_down") })
  ]
});
UI.render(root);
