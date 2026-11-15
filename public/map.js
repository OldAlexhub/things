let map, markers, tile;
window.setExperiences = function (data) {
  if (!map) {
    map = L.map("map", { zoomControl: true }).setView(data.center, 12);
    markers = L.layerGroup().addTo(map);
  }
  if (tile) map.removeLayer(tile);
  const credit = document.createElement("span");
  credit.textContent = data.attribution || "OpenStreetMap contributors";
  tile = L.tileLayer(data.tileUrl, {
    maxZoom: 19,
    attribution:
      (/OpenStreetMap contributors/.test(data.attribution || "")
        ? ""
        : credit.innerHTML + " | ") +
      '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>',
    updateWhenIdle: true,
    keepBuffer: 2,
  }).addTo(map);
  tile.on("tileerror", () => {
    let notice = document.getElementById("tile-status");
    if (!notice) {
      notice = document.createElement("div");
      notice.id = "tile-status";
      notice.textContent =
        "Map imagery unavailable. Location markers are still shown.";
      document.body.append(notice);
    }
  });
  markers.clearLayers();
  const points = [];
  data.items.forEach((item, index) => {
    const position = [item.lat, item.lon];
    points.push(position);
    const icon = L.divIcon({
      html: '<div class="marker">' + (index + 1) + "</div>",
      className: "",
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
    const content = document.createElement("div"),
      title = document.createElement("strong"),
      button = document.createElement("button");
    title.textContent = item.title;
    button.textContent = "See experience";
    button.onclick = () =>
      window.ReactNativeWebView?.postMessage(JSON.stringify({ id: item.id }));
    content.append(title, document.createElement("br"), button);
    L.marker(position, { icon }).bindPopup(content).addTo(markers);
  });
  if (points.length) map.fitBounds(points, { padding: [40, 40], maxZoom: 14 });
};
