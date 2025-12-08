const root = UI.column({
  children: [
    UI.text({ label: "Hello from EMWaver!" }),
    UI.button({ label: "Click Me", onTap: () => console.log("Clicked!") })
  ]
});
UI.render(root);
