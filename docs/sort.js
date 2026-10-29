// Progressive enhancement: the tables are complete without this.
document.querySelectorAll("table th").forEach(function (th) {
  th.addEventListener("click", function () {
    var table = th.closest("table"), body = table.tBodies[0], i = Array.prototype.indexOf.call(th.parentNode.children, th);
    var dir = th.dataset.dir === "asc" ? -1 : 1; th.dataset.dir = dir === 1 ? "asc" : "desc";
    var rows = Array.prototype.slice.call(body.rows);
    rows.sort(function (a, b) {
      var x = a.cells[i].textContent.trim(), y = b.cells[i].textContent.trim(), nx = parseFloat(x.replace(/,/g, "")), ny = parseFloat(y.replace(/,/g, ""));
      return (isNaN(nx) || isNaN(ny) ? x.localeCompare(y) : nx - ny) * dir;
    });
    rows.forEach(function (r) { body.appendChild(r); });
  });
});
document.querySelectorAll(".filter button").forEach(function (b) {
  b.addEventListener("click", function () {
    var f = b.dataset.f;
    document.querySelectorAll("tr[data-tier]").forEach(function (r) { r.style.display = f === "all" || r.dataset.tier === f ? "" : "none"; });
  });
});
