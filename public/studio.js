const $ = (id) => document.getElementById(id);
let csrf = "",
  resource = "overview",
  page = 1,
  items = [],
  editing = null;
const labels = {
  overview: "Your studio",
  campaign: 'Hashtag & memories',
  feeds: 'Event calendars',
  cities: "Destinations",
  categories: "Categories",
  activities: "Experiences",
  events: "Events",
  collections: "Collections",
  media: "Media library",
  sources: "Data sources",
  versions: "App updates",
};
const descriptions = {
  overview: "A thoughtful experience begins with good information.",
  campaign:'Follow public #old_alex_hub memories and keep useful links in one place.',
  feeds:'Connect free public iCalendar feeds to a city. Event facts and organizer links refresh every six hours. No paid event API is used.',
  cities:
    "Publish a destination to make it available in the app. Its homepage order, theme and content are managed here.",
  categories:
    "Build a shared taxonomy. Audience, price and discovery themes can coexist without duplicating experiences.",
  activities:
    "Maintain real places, honest prices, verified hours and source attribution.",
  events: "Dates and status determine which events appear to travelers.",
  collections: "Group existing experiences into stories worth exploring.",
  media:
    "Upload licensed photography. Attribution and license are required for every image.",
  sources:
    "Review commercial permission, retention and attribution before enabling a source. Environment configuration is also required.",
  versions:
    "Use numeric Android version codes. Google Play independently determines update availability.",
};
const templates = {
  feeds:{cityId:'',name:'',url:'',sourceUrl:'',enabled:true,permissionReviewed:false},
  cities: {
    name: "",
    slug: "",
    state: "",
    country: "",
    timezone: "America/New_York",
    latitude: 0,
    longitude: 0,
    geographicBounds: [0, 0, 0, 0],
    description: "",
    publicationStatus: "draft",
    gallery: [],
    theme: { accent: "#12B8A6", background: "#101827" },
    supportedFeatures: ["events", "planning", "maps", "nearby"],
    homeSections: [],
    planTemplates: [],
    recommendationWeights: {
      interest: 30,
      budget: 25,
      distance: 20,
      time: 15,
      novelty: 10,
    },
  },
  categories: {
    name: "",
    slug: "",
    description: "",
    icon: "Compass",
    sortOrder: 0,
    active: true,
    cities: [],
    activityTypes: [],
    kind: "primary",
  },
  activities: {
    cityId: "",
    title: "",
    slug: "",
    description: "",
    shortDescription: "",
    categories: [],
    tags: [],
    audience: [],
    coordinates: { type: "Point", coordinates: [0, 0] },
    location: { address: "", neighborhood: "" },
    images: [],
    priceInformation: { known: false, currency: "USD", perGroup: false },
    source: "manual",
    verificationStatus: "unverified",
    publicationStatus: "draft",
    environment: "unknown",
    weatherSuitability: [],
  },
  collections: {
    cityId: "",
    title: "",
    slug: "",
    description: "",
    activities: [],
    tags: [],
    publicationStatus: "draft",
    sortOrder: 0,
  },
  sources: {
    name: "osm",
    enabled: false,
    permissionReviewed: false,
    license: "",
    attribution: "",
    termsUrl: "https://www.openstreetmap.org/copyright",
    retentionHours: 336,
    intervalMinutes: 10080,
  },
  versions: {
    platform: "android",
    latestVersionCode: 1,
    minimumVersionCode: 1,
    updatePolicy: "optional",
    releaseNotes: [],
  },
};
templates.events = {
  ...templates.activities,
  venue: "",
  startAt: new Date().toISOString(),
  endAt: new Date(Date.now() + 7200000).toISOString(),
  timezone: "America/New_York",
  eventStatus: "scheduled",
  ticketInformation: "",
};
const enums = {
  publicationStatus: ["draft", "published", "unpublished", "archived"],
  verificationStatus: ["unverified", "verified", "needs-review"],
  environment: ["unknown", "indoor", "outdoor", "mixed"],
  kind: ["primary", "audience", "budget", "theme"],
  updatePolicy: ["optional", "recommended", "required"],
  eventStatus: ["scheduled", "cancelled", "rescheduled", "postponed"],
};
const extra = {
  cities: {
    heroImage: {
      url: "https://",
      alt: "",
      credit: "",
      license: "",
      sourceUrl: "https://",
    },
    thumbnailImage: null,
  },
  activities: {
    estimatedDuration: { min: 60, max: 90 },
    ageSuitability: { min: 0 },
    operatingHours: {
      verified: false,
      timezone: "America/New_York",
      weekly: [],
      validUntil: new Date().toISOString(),
    },
    officialWebsite: "",
    bookingUrl: "",
    sourceUrl: "",
    accessibility: "",
    parking: "",
    reservationRequired: false,
    lastVerifiedAt: "",
  },
  categories: { coverImage: null, parentId: "" },
  collections: { coverImage: null },
  versions: { effectiveAt: "", announcement: "", storeUrl: "" },
};
extra.events = extra.activities;
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        c
      ])
  );
function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("toast").hidden = true), 6000);
}
async function api(route, options = {}) {
  const response = await fetch("/api/v1/admin/" + route, {
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      "X-CSRF-Token": csrf,
      ...options.headers,
    },
  });
  const body = await response.json();
  if (!response.ok) {
    if (response.status === 401) {
      $("studio").hidden = true;
      $("login").hidden = false;
    }
    throw new Error(
      body.error?.message +
        (body.error?.fields
          ? " · " +
            body.error.fields.map((f) => f.path + ": " + f.message).join("; ")
          : "")
    );
  }
  return body;
}
function activate(session) {
  csrf = session.csrf;
  $("login").hidden = true;
  $("studio").hidden = false;
  $("nav").replaceChildren();
  for (const [key, label] of Object.entries(labels)) {
    const b = document.createElement("button");
    b.textContent = label;
    b.dataset.resource = key;
    b.onclick = () => {
      resource = key;
      page = 1;
      load().catch((e) => toast(e.message));
    };
    $("nav").append(b);
  }
  load().catch((e) => toast(e.message));
}
$("login-form").onsubmit = async (e) => {
  e.preventDefault();
  try {
    const f = new FormData(e.target);
    activate(
      (
        await api("login", {
          method: "POST",
          body: JSON.stringify(Object.fromEntries(f)),
        })
      ).data
    );
    e.target.reset();
  } catch (error) {
    toast(error.message);
  }
};
$("logout").onclick = async () => {
  try {
    await api("logout", { method: "POST" });
    csrf = "";
    $("studio").hidden = true;
    $("login").hidden = false;
  } catch (e) {
    toast(e.message);
  }
};
let loadSequence = 0;
async function load() {
  const sequence = ++loadSequence;
  document
    .querySelectorAll("nav button")
    .forEach((b) =>
      b.classList.toggle("active", b.dataset.resource === resource)
    );
  $("title").textContent = labels[resource];
  $("description").textContent = descriptions[resource];
  $("new").hidden = ['overview','media','campaign'].includes(resource);
  $("toolbar").hidden = ['overview','campaign'].includes(resource);
  $("content").innerHTML = "<p>Loading your content…</p>";
  if(resource === 'campaign') {
    const d=(await api('campaign')).data;
    if(sequence!==loadSequence)return;
    renderCampaign(d); return;
  }
  if (resource === "overview") {
    const d = (await api("overview")).data;
    if (sequence !== loadSequence) return;
    $("content").innerHTML =
      '<div class="cards">' +
      Object.entries(d.counts)
        .map(
          ([k, v]) =>
            `<article class="stat"><span class="muted">${esc(
              labels[k]
            )}</span><strong>${v}</strong></article>`
        )
        .join("") +
      '</div><div class="panel"><h2>Synchronization history</h2>' +
      table(d.logs, [
        "source",
        "status",
        "recordsReceived",
        "recordsInserted",
        "recordsUpdated",
        "errors",
        "completedAt",
      ]) +
      '</div><div class="panel"><h2>Recent editorial changes</h2>' +
      table(d.audit, ["action", "resource", "resourceId", "createdAt"]) +
      "</div>";
    return;
  }
  const result = await api(resource + "?page=" + page);
  if (sequence !== loadSequence) return;
  items = result.data;
  $("page").textContent = `Page ${page} · ${result.meta.total} records`;
  $("previous").disabled = page === 1;
  $("next").disabled = !result.meta.hasMore;
  renderItems();
  if (resource === "sources") {
    const cities = (await api("cities")).data;
    if (sequence !== loadSequence) return;
    const box = document.createElement("div");
    box.className = "panel";
    box.innerHTML =
      '<h2>Synchronize a city</h2><form id="sync" class="sync-form"><label>Provider<select name="source">' +
      items
        .map((i) => `<option value="${esc(i.name)}">${esc(i.name)}</option>`)
        .join("") +
      '</select></label><label>City<select name="cityId">' +
      cities
        .map((i) => `<option value="${i._id}">${esc(i.name)}</option>`)
        .join("") +
      "</select></label><button>Queue synchronization</button></form>";
    $("content").prepend(box);
    $("sync").onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api("sync", {
          method: "POST",
          body: JSON.stringify(Object.fromEntries(new FormData(e.target))),
        });
        toast("Queued. See the overview for results.");
      } catch (err) {
        toast(err.message);
      }
    };
  }
  if (resource === "media") mediaForm();
}
function table(data, fields) {
  if (!data.length) return "<p>No records yet.</p>";
  return (
    "<table><thead><tr>" +
    fields.map((f) => "<th>" + esc(f) + "</th>").join("") +
    "</tr></thead><tbody>" +
    data
      .map(
        (r) =>
          "<tr>" +
          fields.map((f) => "<td>" + esc(r[f]) + "</td>").join("") +
          "</tr>"
      )
      .join("") +
    "</tbody></table>"
  );
}
function renderCampaign(d) {
  const external=(url,label)=>`<a class="quiet" target="_blank" rel="noopener noreferrer" href="${esc(url)}">${esc(label)} ↗</a>`;
  const when=value=>value?new Date(value).toLocaleString():'Not checked yet';
  $('content').innerHTML=`<div class="campaign-hero"><div class="eyebrow">MEMORIES OUT IN THE WORLD</div><h2>${esc(d.hashtag)}</h2><p>${esc(d.coverage)}</p><button id="check-mentions" ${d.enabled?'':'disabled'}>Check public mentions</button><small> ${d.enabled?'Automatic checks run hourly. Manual checks are limited to once a minute.':'Automatic tracking is disabled in the server environment.'}</small></div>
    <div class="cards"><article class="stat"><span class="muted">Recent observed mentions</span><strong>${d.mentions.length}${d.mentions.length===100?'+':''}</strong></article><article class="stat"><span class="muted">Automatic sources responding</span><strong>${d.checks.filter(c=>c.status==='ok').length} / 2</strong></article></div>
    <div class="panel"><h2>Source coverage</h2>${d.checks.length?d.checks.map(c=>`<article class="source-check"><strong>${esc(c.source)}</strong><span class="badge">${c.status==='ok'?'Checked':'Unavailable'}</span><p>${esc(c.message)}</p><small>Last attempt: ${esc(when(c.checkedAt))} · Last success: ${esc(when(c.lastSuccessAt))}${c.status==='ok'?` · ${c.found} recent matches returned`:''}</small></article>`).join(''):'<p>The first public-source check has not run yet.</p>'}</div>
    <div class="panel"><h2>Search across the web</h2><p>These open searches on each site. Sign-in may be required. They are not automatic tracking sources.</p><div class="campaign-links">${d.links.map(([name,url])=>external(url,name)).join('')}</div></div>
    <div class="panel"><h2>Keep a public post</h2><p>Found a memory on another site? Save its link here for 30 days. No private posts or account access are collected.</p><form id="save-mention"><label>Public post URL<input name="url" type="url" placeholder="https://…" required maxlength="2000"></label><label>Creator / account (optional)<input name="author" maxlength="160"></label><label>Your note (optional)<input name="excerpt" maxlength="300"></label><button>Save link</button></form></div>
    <div class="panel"><h2>Recent public memories</h2>${d.mentions.length?d.mentions.map(m=>`<article class="mention"><div><span class="badge">${esc(m.source)}</span> <strong>${esc(m.author || 'Public post')}</strong><p>${esc(m.excerpt || 'Open the original post to view this memory.')}</p><small>${esc(when(m.postedAt || m.createdAt))}${m.source!=='Saved link'?` · ${m.likes||0} likes · ${m.reposts||0} reposts at last check`:''}</small></div><div>${external(m.url,'View original')}<button class="quiet" data-hide-mention="${m._id}">Hide</button></div></article>`).join(''):'<div class="empty"><h3>The first memory is still ahead.</h3><p>No public mentions have been found by the connected sources yet. Sharing a card does not guarantee a post will be indexed.</p></div>'}</div>`;
  $('check-mentions').onclick=async()=>{const b=$('check-mentions');b.disabled=true;b.textContent='Checking…';try{const result=await api('campaign/check',{method:'POST'});if(resource==='campaign')renderCampaign(result.data);}catch(e){toast(e.message);b.disabled=false;b.textContent='Check public mentions';}};
  $('save-mention').onsubmit=async event=>{event.preventDefault();try{await api('campaign/mentions',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(event.target)))});await load();toast('Public link saved');}catch(e){toast(e.message);}};
  $('content').querySelectorAll('[data-hide-mention]').forEach(button=>button.onclick=async()=>{try{await api('campaign/mentions/'+button.dataset.hideMention,{method:'DELETE'});await load();}catch(e){toast(e.message);}});
}
function renderItems() {
  const term = $("filter").value.toLowerCase();
  const rows = items.filter((i) =>
    JSON.stringify(i).toLowerCase().includes(term)
  );
  $("content").innerHTML = rows.length
    ? '<div class="panel"><table><thead><tr><th>Content</th><th>Status / source</th><th>Updated</th><th>Actions</th></tr></thead><tbody>' +
      rows
        .map(
          (i) =>
            `<tr><td>${
              i.url
                ? `<img class="media" src="${esc(i.url)}" alt="${esc(
                    i.alt
                  )}"><br>`
                : ""
            }<strong>${esc(
              i.title || i.name || i.alt || i.platform
            )}</strong><br><small>${esc(
              i._id
            )}</small></td><td><span class="badge">${esc(
              (resource==='cities' && i.catalogReady===false && i.publicationStatus==='published' ? 'Importing places' : i.publicationStatus) ||
                i.eventStatus ||
                (i.enabled === false
                  ? "disabled"
                  : i.source || i.license || "active")
            )}</span></td><td>${esc(
              new Date(i.updatedAt).toLocaleDateString()
            )}</td><td>${
              resource !== "media"
                ? `<button class="quiet" data-edit="${i._id}">Edit</button><button class="quiet" data-copy="${i._id}">Duplicate</button>`
                : `<button class="quiet" data-url="${esc(
                    i.url
                  )}">Copy URL</button>`
            }<button class="quiet danger" data-delete="${i._id}">${
              resource === "media" ? "Delete" : "Archive / disable"
            }</button></td></tr>`
        )
        .join("") +
      "</tbody></table></div>"
    : '<div class="empty"><h2>A little room for discovery.</h2><p>Create your first record to get started.</p></div>';
  $("content")
    .querySelectorAll("[data-edit]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          openEditor(items.find((i) => i._id === b.dataset.edit)))
    );
  $("content")
    .querySelectorAll("[data-copy]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          const item = { ...items.find((i) => i._id === b.dataset.copy) };
          delete item._id;
          delete item.externalId;
          item.slug && (item.slug += "-copy");
          if (item.publicationStatus) item.publicationStatus = "draft";
          openEditor(item);
        })
    );
  $("content")
    .querySelectorAll("[data-url]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          navigator.clipboard
            .writeText(b.dataset.url)
            .then(() => toast("Image URL copied"))
            .catch(() => toast(b.dataset.url)))
    );
  $("content")
    .querySelectorAll("[data-delete]")
    .forEach(
      (b) =>
        (b.onclick = async () => {
          if (
            !confirm(
              "Archive or remove this record? References may remain in saved itineraries."
            )
          )
            return;
          try {
            await api(resource + "/" + b.dataset.delete, { method: "DELETE" });
            await load();
            toast("Record updated");
          } catch (e) {
            toast(e.message);
          }
        })
    );
}
async function openEditor(item) {
  const editorResource=resource;
  let cityChoices=[];
  if(['feeds','activities','events','collections'].includes(resource)) {
    let next=1,more=true;
    try { while(more && next<=10){const result=await api('cities?page='+next++);cityChoices.push(...result.data);more=result.meta.hasMore;} }
    catch(e){toast(e.message);return;}
    if(resource!==editorResource)return;
  }
  editing = item?._id || null;
  const data = JSON.parse(JSON.stringify(item || templates[resource]));
  for (const key of [
    "_id",
    "id",
    "__v",
    "createdAt",
    "updatedAt",
    "publishedAt",
    "lastSyncedAt",
    "expiresAt",
    "lastSuccessfulSync",
    "qualityScore",
  ])
    delete data[key];
  for (const value of Object.values(data))
    if (Array.isArray(value))
      value.forEach((v) => {
        if (v && typeof v === "object") delete v._id;
      });
  $("edit-title").textContent =
    (editing ? "Edit " : "Create ") + labels[resource];
  $("fields").replaceChildren();
  const optionalKeys = Object.keys(extra[resource] || {});
  const full = {
    ...Object.fromEntries(optionalKeys.map((k) => [k, null])),
    ...data,
  };
  for (const [key, value] of Object.entries(full)) {
    const label = document.createElement("label");
    label.textContent =
      key.replace(/([A-Z])/g, " $1") +
      (optionalKeys.includes(key) ? " (optional)" : "");
    let input;
    if(key==='cityId' && cityChoices.length) {
      input=document.createElement('select');input.add(new Option('Choose a destination',''));
      cityChoices.sort((a,b)=>a.name.localeCompare(b.name)).forEach(city=>input.add(new Option(`${city.name}, ${city.state}`,city._id)));
      input.value=value || '';input.required=true;
    } else if(key==='kind' && resource!=='categories') {
      input=document.createElement('select');['place','hotel'].forEach(v=>input.add(new Option(v,v)));input.value=value;
    } else if (enums[key]) {
      input = document.createElement("select");
      enums[key].forEach((v) => input.add(new Option(v, v)));
      input.value = value;
    } else if (typeof value === "boolean") {
      input = document.createElement("select");
      input.add(new Option("Yes", "true"));
      input.add(new Option("No", "false"));
      input.value = String(value);
      input.dataset.kind = "boolean";
    } else if (
      (value && typeof value === "object") ||
      (optionalKeys.includes(key) && typeof extra[resource][key] === "object")
    ) {
      input = document.createElement("textarea");
      input.value = value ? JSON.stringify(value, null, 2) : "";
      input.placeholder = JSON.stringify(extra[resource]?.[key] || {}, null, 2);
      input.dataset.kind = "json";
      label.className = "wide";
    } else {
      input = document.createElement(
        key === "description" ? "textarea" : "input"
      );
      input.value = value ?? "";
      if (typeof value === "number") {
        input.type = "number";
        input.step = "any";
        input.dataset.kind = "number";
      }
      if (key === "description") label.className = "wide";
    }
    input.name = key;
    input.dataset.optional = String(optionalKeys.includes(key));
    label.append(input);
    $("fields").append(label);
  }
  $("preview").textContent =
    "Select Preview changes to inspect the outgoing record.";
  $("editor").showModal();
}
function readEditor() {
  const data = {};
  for (const input of $("fields").querySelectorAll("input,textarea,select")) {
    if (input.value === "" && input.dataset.optional === "true") continue;
    data[input.name] =
      input.dataset.kind === "json"
        ? JSON.parse(input.value)
        : input.dataset.kind === "boolean"
        ? input.value === "true"
        : input.dataset.kind === "number"
        ? Number(input.value)
        : input.value;
  }
  return data;
}
$("preview-button").onclick = () => {
  try {
    $("preview").textContent = JSON.stringify(readEditor(), null, 2);
    $("preview").parentElement.open = true;
  } catch (e) {
    toast("Invalid JSON in a structured field: " + e.message);
  }
};
$("edit-form").onsubmit = async (e) => {
  e.preventDefault();
  try {
    const data = readEditor();
    await api(resource + (editing ? "/" + editing : ""), {
      method: editing ? "PUT" : "POST",
      body: JSON.stringify(data),
    });
    $("editor").close();
    await load();
    toast("Changes saved");
  } catch (err) {
    toast(err.message);
  }
};
function mediaForm() {
  const p = document.createElement("div");
  p.className = "panel";
  p.innerHTML =
    '<h2>Add photography</h2><form id="upload"><label>Image (JPEG, PNG, WebP; up to 8 MB)<input name="image" type="file" accept="image/jpeg,image/png,image/webp" required></label><label>Accessible description<input name="alt" required></label><label>Creator credit<input name="credit" required></label><label>License / permission<input name="license" required></label><label>Source URL<input name="sourceUrl" type="url" required></label><button>Upload image</button></form>';
  $("content").prepend(p);
  $("upload").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api("media/upload", {
        method: "POST",
        body: new FormData(e.target),
      });
      await load();
      toast("Image uploaded");
    } catch (err) {
      toast(err.message);
    }
  };
}
$("new").onclick = () => resource === "cities" ? openCityWizard() : openEditor();
$("close").onclick = () => $("editor").close();
$("filter").oninput = renderItems;
$("refresh").onclick = () => load().catch((e) => toast(e.message));
$("previous").onclick = () => {
  page--;
  load().catch((e) => toast(e.message));
};
$("next").onclick = () => {
  page++;
  load().catch((e) => toast(e.message));
};
api("session")
  .then((r) => activate(r.data))
  .catch(() => {});

let selectedCity;
function openCityWizard(){selectedCity=null;$("city-custom-zone").value="";$("city-create").hidden=true;$("city-results").replaceChildren();$("city-search-status").textContent='';$("city-create-status").textContent='';$("city-wizard").showModal();$("city-query").focus();}
$("city-close").onclick=()=>$("city-wizard").close();
$("city-search").onsubmit=async e=>{e.preventDefault();$("city-find").disabled=true;$("city-search-status").textContent='Finding your city...';try{
  const result=await api('city-lookup?q='+encodeURIComponent($("city-query").value));$("city-results").replaceChildren();$("city-search-status").textContent=result.data.length?'Choose the correct destination.':'No city found. Try adding its state or country.';
  for(const city of result.data){const button=document.createElement('button');button.type='button';button.className='city-result quiet';button.textContent=city.label;button.onclick=()=>{selectedCity=city;$("city-selected").textContent=city.label;$("city-welcome").value=`Find your next good day in ${city.name}. Explore local places and build a day around what you love.`;$("city-timezone").value=city.longitude < -115?'America/Los_Angeles':city.longitude < -102?'America/Denver':city.longitude < -85?'America/Chicago':'America/New_York';$("city-create").hidden=false;$("city-create").scrollIntoView({behavior:'smooth'});};$("city-results").append(button);}
}catch(err){$("city-search-status").textContent=err.message;}finally{$("city-find").disabled=false;}};
$("city-create").onsubmit=async e=>{e.preventDefault();if(!selectedCity)return;$("city-enable").disabled=true;$("city-create-status").textContent='Preparing the destination...';try{
  const {label,...city}=selectedCity;
  const slug=[city.name,city.state||city.country].join('-').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  const data={...templates.cities,...city,slug,description:$("city-welcome").value,timezone:$("city-custom-zone").value.trim()||$("city-timezone").value,publicationStatus:'published',homeSections:[{key:'discover',title:'Worth a place in your day',type:'activities',visible:true,order:0,tags:[]},{key:'outdoors',title:'A little fresh air',type:'activities',visible:true,order:1,tags:['outdoors']},{key:'free',title:'Good days. Small budgets.',type:'activities',visible:true,order:2,tags:['free']}]};
  await api('cities',{method:'POST',body:JSON.stringify(data)});$("city-wizard").close();await load();toast('City enabled. Places and licensed photos are importing automatically. Check Your studio for progress.');
}catch(err){$("city-create-status").textContent=err.message;}finally{$("city-enable").disabled=false;}};
