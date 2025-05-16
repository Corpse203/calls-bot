document.addEventListener("DOMContentLoaded", () => {
  const callList = document.getElementById("callList");

  const sortable = new Sortable(callList, {
    animation: 150,
    disabled: !window.isAdmin,
    onEnd: async () => {
      const items = [...callList.children];
      const newOrder = items.map(li => ({
        slot: li.dataset.slot,
        user: li.dataset.user
      }));

      await fetch("/api/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newOrder })
      });
    }
  });

  window.updateSortable = () => {
    sortable.option("disabled", !window.isAdmin);
  };
});
