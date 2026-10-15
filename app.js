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

function $(selector) {
  return document.querySelector(selector);
}

function setupHeroParallax() {
  const hero = $("#home");
  const scene = $("#heroScene");
  const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (!hero || !scene || !canHover || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  hero.addEventListener("pointermove", (event) => {
    const rect = hero.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    scene.style.setProperty("--scene-x", `${x * 14}px`);
    scene.style.setProperty("--scene-y", `${y * 10}px`);
    scene.style.setProperty("--scene-rotate", `${x * 1.4}deg`);
  });

  hero.addEventListener("pointerleave", () => {
    scene.style.setProperty("--scene-x", "0px");
    scene.style.setProperty("--scene-y", "0px");
    scene.style.setProperty("--scene-rotate", "0deg");
  });
}

function setupDepthCards() {
  const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (!canHover || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  document.querySelectorAll(".trust-card, .group-type-card, .destination-image-card").forEach((card) => {
    card.addEventListener("pointermove", (event) => {
      const rect = card.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      card.style.setProperty("--card-rotate-x", `${y * -4}deg`);
      card.style.setProperty("--card-rotate-y", `${x * 5}deg`);
    });

    card.addEventListener("pointerleave", () => {
      card.style.setProperty("--card-rotate-x", "0deg");
      card.style.setProperty("--card-rotate-y", "0deg");
    });
  });
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
setupDepthCards();

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

function getQuoteWhatsAppUrl(data) {
  const message = encodeURIComponent(formatQuoteWhatsAppMessage(data));
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${message}`;
}

function openQuoteOnWhatsApp(data) {
  const link = document.createElement("a");
  link.href = getQuoteWhatsAppUrl(data);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.click();
}

const quoteForm = $("#quoteForm");
if (quoteForm) {
  quoteForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!validateQuoteForm()) return;
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    openQuoteOnWhatsApp(data);
    event.currentTarget.reset();
    $("#formMessage").textContent = "WhatsApp is opening with your quote details ready. Send the message there to submit your request.";
  });
}
