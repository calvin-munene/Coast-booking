const services = [
  "School Trips",
  "Church Retreats",
  "Corporate Retreats",
  "University & College Groups",
  "Sports Teams",
  "Family Groups",
  "NGO Groups",
  "Tour Groups",
  "Meal Coordination",
  "Transport Coordination"
];

const WHATSAPP_NUMBER = "254741076845";

initOceanScene();

const groupTypes = [
  { title: "School trips", page: "school-trips.html", icon: "ST" },
  { title: "Church retreats", page: "church-retreats.html", icon: "CR" },
  { title: "Corporate groups", page: "corporate-groups.html", icon: "CG" },
  { title: "University and college groups", page: "university-college-groups.html", icon: "UC" },
  { title: "Sports teams", page: "sports-teams.html", icon: "SP" },
  { title: "NGO groups", page: "ngo-groups.html", icon: "NG" },
  { title: "Tour groups", page: "tour-groups.html", icon: "TG" },
  { title: "Family groups", page: "family-groups.html", icon: "FG" }
];

const destinations = [
  {
    title: "Mombasa",
    page: "mombasa.html",
    image: "https://images.unsplash.com/photo-1589308078059-be1415eab4c3?auto=format&fit=crop&w=900&q=80&fm=webp",
    description: "Central coast access for schools, churches, companies and tour groups."
  },
  {
    title: "Nyali",
    page: "nyali.html",
    image: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=80&fm=webp",
    description: "Convenient north coast stays near beaches, meeting venues and group facilities."
  },
  {
    title: "Bamburi",
    page: "bamburi.html",
    image: "https://images.unsplash.com/photo-1540541338287-41700207dee6?auto=format&fit=crop&w=900&q=80&fm=webp",
    description: "Practical group accommodation options for active coastal itineraries."
  },
  {
    title: "Shanzu",
    page: "shanzu.html",
    image: "https://images.unsplash.com/photo-1519046904884-53103b34b206?auto=format&fit=crop&w=900&q=80&fm=webp",
    description: "Quiet north coast setting for retreats, teams and organized group travel."
  },
  {
    title: "Diani",
    page: "diani.html",
    image: "https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=900&q=80&fm=webp",
    description: "White-sand south coast stays for corporate retreats, families and tour groups."
  },
  {
    title: "Kilifi",
    page: "kilifi.html",
    image: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80&fm=webp",
    description: "Relaxed coastal options for universities, NGOs and retreat-style groups."
  },
  {
    title: "Watamu",
    page: "watamu.html",
    image: "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=900&q=80&fm=webp",
    description: "Scenic group stays for tours, families and teams exploring the north coast."
  }
];

const reasons = [
  "Trusted Local Partners",
  "Personalized Service",
  "Affordable Group Solutions",
  "Fast Response",
  "Safe Accommodation",
  "Local Coast Experts"
];

const gallery = [
  {
    title: "Beaches",
    image: "https://images.unsplash.com/photo-1540541338287-41700207dee6?auto=format&fit=crop&w=1200&q=80"
  },
  {
    title: "Hotels",
    image: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=900&q=80"
  },
  {
    title: "Guest Houses",
    image: "https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=900&q=80"
  },
  {
    title: "School Dormitories",
    image: "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?auto=format&fit=crop&w=1200&q=80"
  },
  {
    title: "Conference Halls",
    image: "https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=900&q=80"
  },
  {
    title: "Dining Areas",
    image: "https://images.unsplash.com/photo-1551218808-94e220e084d2?auto=format&fit=crop&w=900&q=80"
  },
  {
    title: "Group Activities",
    image: "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&w=900&q=80"
  }
];

const testimonials = [
  {
    name: "Grace W.",
    groupType: "School trip",
    destination: "Mombasa",
    review: "The team understood our school travel needs and helped us compare suitable group accommodation quickly."
  },
  {
    name: "Pastor Daniel M.",
    groupType: "Church retreat",
    destination: "Diani",
    review: "Meals, room setup and location were coordinated clearly, which made our retreat planning much easier."
  },
  {
    name: "Amina K.",
    groupType: "Sports team",
    destination: "Nyali",
    review: "We needed a practical stay for a large team. Coast Bookings helped narrow the options without guesswork."
  }
];

const faqs = [
  {
    question: "Can you arrange school trip accommodation in Mombasa?",
    answer: "Yes. Share your dates, number of learners or staff, meal needs and preferred area, and our team will coordinate suitable options."
  },
  {
    question: "Do you help with church group accommodation?",
    answer: "Yes. We coordinate church retreat accommodation across Mombasa, Diani, Nyali, Bamburi, Shanzu, Kilifi and Watamu."
  },
  {
    question: "Do you arrange meal requirements?",
    answer: "Meal arrangements can be included in the quote request, including breakfast, half board, full board and special diet support."
  },
  {
    question: "Can you help with transport coordination?",
    answer: "Yes. Transport coordination can be noted in your request so the team can advise on suitable transfer or movement support."
  },
  {
    question: "Which destinations do you cover?",
    answer: "We coordinate group stays in Mombasa, Nyali, Bamburi, Shanzu, Diani, Kilifi, Watamu and nearby Kenyan Coast locations."
  },
  {
    question: "How do quotations work?",
    answer: "You submit group details, we review suitable accommodation options, then send a personalized quotation. There is no instant booking."
  },
  {
    question: "How fast will I receive a response?",
    answer: "Response time depends on dates, group size and destination, but the team aims to respond quickly with practical options."
  },
  {
    question: "Can you accommodate large groups?",
    answer: "Yes. We regularly coordinate requests for schools, churches, companies, universities, NGOs and tour groups of different sizes."
  }
];

const statuses = ["New", "Contacted", "Quoted", "Confirmed", "Completed", "Cancelled"];
const adminTabs = [
  "Requests",
  "Partners",
  "Destinations",
  "Gallery",
  "Testimonials",
  "Analytics",
  "Export"
];

const defaultState = {
  requests: [],
  partners: ["Trusted hotel partner", "Group guest house partner", "Conference accommodation partner"],
  destinations: destinations.map((destination) => destination.title),
  gallery: gallery.map((item) => item.title),
  testimonials: testimonials.map((item) => `${item.name} - ${item.groupType}`),
  activeTab: "Requests"
};

const state = loadState();

function loadState() {
  const stored = JSON.parse(localStorage.getItem("coastbookings-admin") || "null");
  return stored ? { ...defaultState, ...stored } : structuredClone(defaultState);
}

function saveState() {
  localStorage.setItem("coastbookings-admin", JSON.stringify(state));
}

function $(selector) {
  return document.querySelector(selector);
}

function setupHeroParallax() {
  const hero = $("#home");
  const scene = $("#heroScene");
  if (!hero || !scene || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  hero.addEventListener("pointermove", (event) => {
    const rect = hero.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    scene.style.setProperty("--scene-x", `${x * 14}px`);
    scene.style.setProperty("--scene-y", `${y * 10}px`);
    scene.style.setProperty("--scene-rotate", `${x * 1.4}deg`);
  });
}

async function initOceanScene() {
  const canvas = $("#oceanScene");
  if (!canvas) return;

  try {
    const THREE = await import("https://unpkg.com/three@0.160.0/build/three.module.js");
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 120);
    camera.position.set(0, 5.2, 10.5);
    camera.lookAt(0, 0.1, 0);

    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(1.05, 32, 32),
      new THREE.MeshBasicMaterial({ color: 0xff8a3d })
    );
    sun.position.set(5.8, 4.2, -8);
    scene.add(sun);

    const beach = new THREE.Mesh(
      new THREE.PlaneGeometry(28, 8, 1, 1),
      new THREE.MeshLambertMaterial({ color: 0xf4d19b })
    );
    beach.rotation.x = -Math.PI / 2;
    beach.position.set(0, -0.85, 5.1);
    scene.add(beach);

    const waterGeometry = new THREE.PlaneGeometry(36, 26, 96, 96);
    const waterMaterial = new THREE.MeshStandardMaterial({
      color: 0x0f78a4,
      roughness: 0.42,
      metalness: 0.08,
      transparent: true,
      opacity: 0.92
    });
    const water = new THREE.Mesh(waterGeometry, waterMaterial);
    water.rotation.x = -Math.PI / 2;
    water.position.z = -2.8;
    scene.add(water);

    const foamMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.62 });
    const foamLines = Array.from({ length: 5 }, (_, index) => {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(16 - index * 1.6, 0.035, 1, 1), foamMaterial.clone());
      line.rotation.x = -Math.PI / 2;
      line.position.set(-1.2 + index * 0.35, -0.32, 2.1 - index * 1.15);
      scene.add(line);
      return line;
    });

    scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const light = new THREE.DirectionalLight(0xffd7a3, 2.4);
    light.position.set(6, 8, 4);
    scene.add(light);

    const positions = waterGeometry.attributes.position;
    const base = positions.array.slice();
    const clock = new THREE.Clock();

    function resize() {
      const width = canvas.clientWidth || window.innerWidth;
      const height = canvas.clientHeight || window.innerHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    function animate() {
      const time = clock.getElapsedTime();
      for (let i = 0; i < positions.count; i += 1) {
        const x = base[i * 3];
        const y = base[i * 3 + 1];
        positions.array[i * 3 + 2] =
          Math.sin(x * 0.75 + time * 1.2) * 0.2 +
          Math.cos(y * 0.55 + time * 0.9) * 0.16;
      }
      positions.needsUpdate = true;
      waterGeometry.computeVertexNormals();
      foamLines.forEach((line, index) => {
        line.position.x = Math.sin(time * 0.8 + index) * 0.7;
        line.material.opacity = 0.32 + Math.sin(time * 1.4 + index) * 0.16;
      });
      sun.position.y = 4.2 + Math.sin(time * 0.35) * 0.12;
      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    }

    resize();
    window.addEventListener("resize", resize);
    animate();
  } catch (error) {
    canvas.classList.add("scene-fallback");
  }
}

function renderCardGrid(selector, items, cardClass, textBuilder) {
  const container = $(selector);
  if (!container) return;
  container.innerHTML = items
    .map(
      (item, index) => `
        <article class="${cardClass} reveal">
          <span class="card-icon">${String(index + 1).padStart(2, "0")}</span>
          ${textBuilder(item)}
        </article>
      `
    )
    .join("");
}

renderCardGrid("#servicesGrid", services, "service-pill", (service) => `
  <h3>${service}</h3>
`);

renderCardGrid("#groupTypesGrid", groupTypes, "group-type-card", (group) => `
  <a href="${group.page}" aria-label="${group.title} accommodation">
    <span class="floating-icon">${group.icon}</span>
    <h3>${group.title}</h3>
    <p>Request suitable group accommodation options for your itinerary and guest count.</p>
  </a>
`);

const destinationGrid = $("#destinationGrid");
if (destinationGrid) {
  destinationGrid.innerHTML = destinations
    .map(
      (destination) => `
        <a class="destination-image-card reveal" href="${destination.page}" aria-label="Group accommodation in ${destination.title}">
          <img src="${destination.image}" alt="Coastal accommodation area in ${destination.title}, Kenya" loading="lazy" />
          <span class="map-pin" aria-hidden="true"></span>
          <div>
            <h3>${destination.title}</h3>
            <p>${destination.description}</p>
          </div>
        </a>
      `
    )
    .join("");
}

renderCardGrid("#whyGrid", reasons, "info-card", (reason) => `
  <h3>${reason}</h3>
  <p>Clear coordination, local knowledge and suitable recommendations for group stays along the Coast.</p>
`);

const galleryGrid = $("#galleryGrid");
if (galleryGrid) {
  galleryGrid.innerHTML = gallery
    .map(
      (item) => `
        <figure class="gallery-item reveal">
          <img src="${item.image}" alt="${item.title}" loading="lazy" />
          <span>${item.title}</span>
        </figure>
      `
    )
    .join("");
}

const testimonialGrid = $("#testimonialGrid");
if (testimonialGrid) {
  testimonialGrid.innerHTML = testimonials
    .map(
      (item) => `
        <article class="testimonial-card reveal">
          <p class="review">"${item.review}"</p>
          <h3>${item.name}</h3>
          <p>${item.organization}</p>
        </article>
      `
    )
    .join("");
}

const testimonialSlider = $("#testimonialSlider");
if (testimonialSlider) {
  testimonialSlider.innerHTML = testimonials
    .map(
      (item) => `
        <article class="testimonial-card">
          <p class="review">"${item.review}"</p>
          <h3>${item.name}</h3>
          <p>${item.groupType} · ${item.destination}</p>
        </article>
      `
    )
    .join("");
}

const faqList = $("#faqList");
if (faqList) {
  faqList.innerHTML = faqs
    .map(
      (item, index) => `
        <article class="faq-item ${index === 0 ? "open" : ""}">
          <button type="button" aria-expanded="${index === 0 ? "true" : "false"}">
            ${item.question}
            <span>+</span>
          </button>
          <p>${item.answer}</p>
        </article>
      `
    )
    .join("");
}

const menuToggle = $("#menuToggle");
const navLinks = $("#navLinks");

if (menuToggle && navLinks) {
  menuToggle.addEventListener("click", () => {
    navLinks.classList.toggle("open");
    document.body.classList.toggle("menu-open", navLinks.classList.contains("open"));
  });

  navLinks.addEventListener("click", (event) => {
    if (event.target.closest("a")) {
      navLinks.classList.remove("open");
      document.body.classList.remove("menu-open");
    }
  });
}

if (faqList) {
  faqList.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const item = button.closest(".faq-item");
    item.classList.toggle("open");
    button.setAttribute("aria-expanded", String(item.classList.contains("open")));
  });
}

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12 }
);

document.querySelectorAll(".reveal").forEach((element) => observer.observe(element));
setupHeroParallax();

window.addEventListener("scroll", () => {
  const header = $(".site-header");
  if (header) header.classList.toggle("scrolled", window.scrollY > 24);
});

function validateQuoteForm() {
  const stepElement = $("#quoteForm");
  const message = $("#formMessage");
  if (!stepElement) return true;
  const invalid = [...stepElement.querySelectorAll("[required]")].find((field) => !field.checkValidity());
  if (invalid) {
    invalid.reportValidity();
    if (message) message.textContent = "Please complete the required fields before continuing.";
    return false;
  }
  if (message) message.textContent = "";
  return true;
}

function valueOrFallback(value) {
  return value && value.trim() ? value.trim() : "Not provided";
}

function formatQuoteWhatsAppMessage(data) {
  const lines = [
    "Hello Coast Bookings, I would like to request a group accommodation quotation.",
    "",
    "GROUP QUOTE REQUEST",
    `Full Name: ${valueOrFallback(data.fullName)}`,
    `Organization: ${valueOrFallback(data.organization)}`,
    `Phone Number: ${valueOrFallback(data.phone)}`,
    `Email: ${valueOrFallback(data.email)}`,
    `Group Type: ${valueOrFallback(data.groupType)}`,
    `Number of Guests: ${valueOrFallback(data.guests)}`,
    `Arrival Date: ${valueOrFallback(data.arrival)}`,
    `Departure Date: ${valueOrFallback(data.departure)}`,
    `Destination: ${valueOrFallback(data.destination)}`,
    `Meal Requirements: ${valueOrFallback(data.meals)}`,
    `Preferred Area: ${valueOrFallback(data.preferredArea)}`,
    "",
    "Additional Notes:",
    valueOrFallback(data.notes),
    "",
    "Please send suitable accommodation options and a personalized quotation."
  ];

  return lines.join("\n");
}

function openQuoteOnWhatsApp(data) {
  const message = encodeURIComponent(formatQuoteWhatsAppMessage(data));
  window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${message}`, "_blank", "noopener,noreferrer");
}

const quoteForm = $("#quoteForm");
if (quoteForm) {
  quoteForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!validateQuoteForm()) return;
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    state.requests.unshift({
      id: crypto.randomUUID(),
      status: "New",
      createdAt: new Date().toISOString(),
      ...data
    });
    saveState();
    openQuoteOnWhatsApp(data);
    event.currentTarget.reset();
    $("#formMessage").textContent = "Thank you. WhatsApp is opening with your request details ready to send.";
    const dashboard = $("#dashboard");
    if (dashboard && !dashboard.classList.contains("hidden")) renderDashboard();
  });
}

const contactForm = $("#contactForm");
if (contactForm) {
  contactForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    state.requests.unshift({
      id: crypto.randomUUID(),
      status: "New",
      createdAt: new Date().toISOString(),
      fullName: data.name,
      phone: data.phone,
      email: data.email,
      notes: data.message,
      groupType: "Contact Form",
      guests: "",
      arrival: "",
      departure: "",
      destination: "",
      meals: ""
    });
    saveState();
    event.currentTarget.reset();
    location.hash = "quote";
    const formMessage = $("#formMessage");
    if (formMessage) formMessage.textContent = "Thank you. Our team will contact you shortly with suitable accommodation options.";
    const dashboard = $("#dashboard");
    if (dashboard && !dashboard.classList.contains("hidden")) renderDashboard();
  });
}

const loginButton = $("#loginButton");
if (loginButton) {
  loginButton.addEventListener("click", () => {
    const user = $("#adminUser").value.trim();
    const pass = $("#adminPass").value.trim();
    if (user !== "admin" || pass !== "coast2026") {
      $(".admin-hint").textContent = "Invalid login. Use admin / coast2026 for the demo dashboard.";
      return;
    }
    $("#adminLogin").classList.add("hidden");
    $("#dashboard").classList.remove("hidden");
    renderDashboard();
  });
}

const logoutButton = $("#logoutButton");
if (logoutButton) {
  logoutButton.addEventListener("click", () => {
    $("#dashboard").classList.add("hidden");
    $("#adminLogin").classList.remove("hidden");
  });
}

function renderDashboard() {
  if (!$("#adminTabs") || !$("#dashboardPanel")) return;
  $("#adminTabs").innerHTML = adminTabs
    .map((tab) => `<button class="${tab === state.activeTab ? "active" : ""}" type="button" data-tab="${tab}">${tab}</button>`)
    .join("");

  const panel = $("#dashboardPanel");
  if (state.activeTab === "Requests") panel.innerHTML = renderRequests();
  if (state.activeTab === "Partners") panel.innerHTML = renderManager("partners", "Accommodation Partners");
  if (state.activeTab === "Destinations") panel.innerHTML = renderManager("destinations", "Destinations");
  if (state.activeTab === "Gallery") panel.innerHTML = renderManager("gallery", "Gallery Categories");
  if (state.activeTab === "Testimonials") panel.innerHTML = renderManager("testimonials", "Testimonials");
  if (state.activeTab === "Analytics") panel.innerHTML = renderAnalytics();
  if (state.activeTab === "Export") panel.innerHTML = renderExport();
}

const adminTabsEl = $("#adminTabs");
if (adminTabsEl) {
  adminTabsEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-tab]");
    if (!button) return;
    state.activeTab = button.dataset.tab;
    saveState();
    renderDashboard();
  });
}

const dashboardPanel = $("#dashboardPanel");
if (dashboardPanel) {
  dashboardPanel.addEventListener("change", (event) => {
    const select = event.target.closest("[data-status]");
    if (!select) return;
    const request = state.requests.find((item) => item.id === select.dataset.status);
    if (!request) return;
    request.status = select.value;
    saveState();
    renderDashboard();
  });

  dashboardPanel.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.target.closest("[data-manager]");
    if (!form) return;
    const key = form.dataset.manager;
    const value = new FormData(form).get("value").trim();
    if (!value) return;
    state[key].push(value);
    saveState();
    renderDashboard();
  });

  dashboardPanel.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove]");
    const deleteRequest = event.target.closest("[data-delete-request]");
    const clearRequests = event.target.closest("[data-clear-requests]");
    const exportButton = event.target.closest("[data-export]");
    if (remove) {
      const [key, index] = remove.dataset.remove.split(":");
      state[key].splice(Number(index), 1);
      saveState();
      renderDashboard();
    }
    if (deleteRequest) {
      state.requests = state.requests.filter((request) => request.id !== deleteRequest.dataset.deleteRequest);
      saveState();
      renderDashboard();
    }
    if (clearRequests) {
      state.requests = [];
      saveState();
      renderDashboard();
    }
    if (exportButton) exportRequests();
  });
}

function renderRequests() {
  if (!state.requests.length) {
    return "<p>No quote requests yet. Submitted forms will appear here.</p>";
  }
  return `
    <div class="table-actions">
      <button class="btn btn-secondary btn-small" type="button" data-clear-requests>Clear Requests</button>
    </div>
    <table class="admin-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Client</th>
          <th>Group</th>
          <th>Dates</th>
          <th>Destination</th>
          <th>Meals</th>
          <th>Status</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        ${state.requests
          .map(
            (request) => `
              <tr>
                <td>${new Date(request.createdAt).toLocaleDateString()}</td>
                <td><strong>${request.fullName || "Unknown"}</strong><br />${request.phone || ""}<br />${request.email || ""}</td>
                <td>${request.groupType || ""}<br />${request.guests ? `${request.guests} guests` : ""}</td>
                <td>${request.arrival || ""}<br />${request.departure || ""}</td>
                <td>${request.destination || ""}<br />${request.preferredArea || ""}</td>
                <td>${request.meals || ""}<br />${request.notes || ""}</td>
                <td>
                  <select class="status-select" data-status="${request.id}">
                    ${statuses.map((status) => `<option ${status === request.status ? "selected" : ""}>${status}</option>`).join("")}
                  </select>
                </td>
                <td><button class="btn btn-secondary btn-small" type="button" data-delete-request="${request.id}">Delete</button></td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderManager(key, title) {
  return `
    <form class="manager-form" data-manager="${key}">
      <label>${title}<input name="value" type="text" placeholder="Add new item" /></label>
      <button class="btn btn-primary btn-small" type="submit">Add</button>
    </form>
    <div class="manager-grid">
      ${state[key]
        .map(
          (item, index) => `
            <article class="manager-card">
              <h3>${item}</h3>
              <button class="btn btn-secondary btn-small" type="button" data-remove="${key}:${index}">Remove</button>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderAnalytics() {
  const total = state.requests.length;
  const confirmed = state.requests.filter((request) => request.status === "Confirmed").length;
  const quoted = state.requests.filter((request) => request.status === "Quoted").length;
  return `
    <div class="analytics-grid">
      <article class="metric-card"><h3>Total Requests</h3><strong>${total}</strong></article>
      <article class="metric-card"><h3>Quoted</h3><strong>${quoted}</strong></article>
      <article class="metric-card"><h3>Confirmed</h3><strong>${confirmed}</strong></article>
    </div>
  `;
}

function renderExport() {
  return `
    <p>Export quote requests as a CSV file for follow-up and reporting.</p>
    <button class="btn btn-primary" type="button" data-export>Export Requests</button>
  `;
}

function exportRequests() {
  const headers = ["createdAt", "status", "fullName", "organization", "phone", "email", "groupType", "guests", "arrival", "departure", "destination", "meals", "preferredArea", "notes"];
  const rows = state.requests.map((request) =>
    headers.map((header) => `"${String(request[header] || "").replaceAll('"', '""')}"`).join(",")
  );
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "coastbookings-quote-requests.csv";
  link.click();
  URL.revokeObjectURL(url);
}
