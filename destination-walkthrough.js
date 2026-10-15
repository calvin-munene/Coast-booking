(() => {
  const scenes = {
    mombasa: {
      name: "Mombasa",
      image:
        "https://images.unsplash.com/photo-1589308078059-be1415eab4c3?auto=format&fit=crop&w=1000&q=80&fm=webp",
    },
    nyali: {
      name: "Nyali",
      image:
        "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1000&q=80&fm=webp",
    },
    bamburi: {
      name: "Bamburi",
      image:
        "https://images.unsplash.com/photo-1540541338287-41700207dee6?auto=format&fit=crop&w=1000&q=80&fm=webp",
    },
    shanzu: {
      name: "Shanzu",
      image:
        "https://images.unsplash.com/photo-1519046904884-53103b34b206?auto=format&fit=crop&w=1000&q=80&fm=webp",
    },
    diani: {
      name: "Diani",
      image:
        "https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=1000&q=80&fm=webp",
    },
    kilifi: {
      name: "Kilifi",
      image:
        "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1000&q=80&fm=webp",
    },
    watamu: {
      name: "Watamu",
      image:
        "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=1000&q=80&fm=webp",
    },
  };

  const slug = document.body.dataset.destination;
  const place = scenes[slug];
  const mount = document.querySelector("[data-destination-experience]");
  if (!place || !mount) return;

  const section = document.createElement("section");
  section.className = "destination-experience";
  section.setAttribute("aria-labelledby", `${slug}-experience-title`);
  section.innerHTML = `
    <div class="destination-experience-copy">
      <p class="eyebrow">Interactive destination view</p>
      <h2 id="${slug}-experience-title"></h2>
      <p class="destination-experience-description">
        Rotate the coastal scene to explore a different perspective. The artwork is illustrative,
        not a navigational map or a preview of a specific hotel.
      </p>
      <a class="btn btn-primary" href="index.html#quote">Plan a group stay</a>
    </div>
    <div class="destination-scene-explorer">
      <div class="destination-scene-stage" tabindex="0" role="group" aria-describedby="${slug}-scene-help">
        <div class="destination-scene-diorama" aria-hidden="true">
          <div class="destination-scene-sun"></div>
          <div class="destination-scene-water"></div>
          <div class="destination-scene-island"></div>
          <div class="destination-scene-reef"></div>
          <div class="destination-scene-photo">
            <img alt="" loading="lazy" decoding="async" />
            <span>Coastal atmosphere · illustrative</span>
          </div>
          <div class="destination-scene-pin">
            <span class="destination-scene-pin-dot"></span>
            <span class="destination-scene-pin-label"></span>
          </div>
        </div>
      </div>
      <p class="destination-scene-help" id="${slug}-scene-help">
        Drag to rotate, or focus the scene and use the arrow keys. Use the buttons to zoom.
      </p>
      <div class="destination-scene-controls" role="group" aria-label="Coastal scene controls">
        <button type="button" data-scene-action="rotate-left" aria-label="Rotate view left">↶</button>
        <button type="button" data-scene-action="zoom-out" aria-label="Zoom out">−</button>
        <button type="button" data-scene-action="reset" aria-label="Reset scene view">Reset</button>
        <button type="button" data-scene-action="zoom-in" aria-label="Zoom in">+</button>
        <button type="button" data-scene-action="rotate-right" aria-label="Rotate view right">↷</button>
      </div>
      <p class="destination-scene-status" aria-live="polite" aria-atomic="true"></p>
    </div>
  `;

  const title = section.querySelector("h2");
  const pinLabel = section.querySelector(".destination-scene-pin-label");
  const photo = section.querySelector(".destination-scene-photo img");
  const stage = section.querySelector(".destination-scene-stage");
  const diorama = section.querySelector(".destination-scene-diorama");
  const status = section.querySelector(".destination-scene-status");
  title.textContent = `Explore ${place.name} in 3D`;
  pinLabel.textContent = place.name;
  stage.setAttribute(
    "aria-label",
    `Illustrative 3D coastal scene for ${place.name}. Use arrow keys to rotate, plus or minus to zoom, and Home to reset.`,
  );
  photo.src = place.image;
  photo.alt = "";

  const imageUrl = new URL(place.image);
  if (imageUrl.protocol === "https:" && imageUrl.hostname === "images.unsplash.com") {
    photo.src = imageUrl.href;
  }

  mount.replaceWith(section);

  let rotation = 0;
  let tilt = 52;
  let zoom = 1;
  let dragging = false;
  let previousX = 0;
  let previousY = 0;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function updateView(announce = true) {
    diorama.style.setProperty("--coast-rotation", `${rotation}deg`);
    diorama.style.setProperty("--coast-tilt", `${tilt}deg`);
    diorama.style.setProperty("--coast-zoom", zoom.toFixed(2));
    if (announce) {
      status.textContent = `View adjusted. Zoom ${Math.round(zoom * 100)} percent.`;
    }
  }

  function rotate(amount) {
    rotation = clamp(rotation + amount, -38, 38);
    updateView();
  }

  function changeZoom(amount) {
    zoom = clamp(zoom + amount, 0.82, 1.24);
    updateView();
  }

  function resetView() {
    rotation = 0;
    tilt = 52;
    zoom = 1;
    updateView();
  }

  section.querySelectorAll("[data-scene-action]").forEach((button) => {
    button.addEventListener("click", () => {
      switch (button.dataset.sceneAction) {
        case "rotate-left":
          rotate(-12);
          break;
        case "rotate-right":
          rotate(12);
          break;
        case "zoom-in":
          changeZoom(0.08);
          break;
        case "zoom-out":
          changeZoom(-0.08);
          break;
        default:
          resetView();
      }
    });
  });

  stage.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragging = true;
    previousX = event.clientX;
    previousY = event.clientY;
    stage.classList.add("is-dragging");
    stage.setPointerCapture(event.pointerId);
  });

  stage.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const deltaX = event.clientX - previousX;
    const deltaY = event.clientY - previousY;
    previousX = event.clientX;
    previousY = event.clientY;
    rotation = clamp(rotation + deltaX * 0.42, -38, 38);
    tilt = clamp(tilt + deltaY * 0.2, 42, 62);
    updateView(false);
  });

  function stopDragging() {
    if (!dragging) return;
    dragging = false;
    stage.classList.remove("is-dragging");
    status.textContent = `View adjusted. Zoom ${Math.round(zoom * 100)} percent.`;
  }

  stage.addEventListener("pointerup", stopDragging);
  stage.addEventListener("pointercancel", stopDragging);
  stage.addEventListener("lostpointercapture", stopDragging);

  stage.addEventListener("keydown", (event) => {
    const keyActions = {
      ArrowLeft: () => rotate(-8),
      ArrowRight: () => rotate(8),
      ArrowUp: () => {
        tilt = clamp(tilt - 4, 42, 62);
        updateView();
      },
      ArrowDown: () => {
        tilt = clamp(tilt + 4, 42, 62);
        updateView();
      },
      "+": () => changeZoom(0.08),
      "=": () => changeZoom(0.08),
      "-": () => changeZoom(-0.08),
      Home: resetView,
    };
    const action = keyActions[event.key];
    if (action) {
      event.preventDefault();
      action();
    }
  });

  updateView(false);
})();
