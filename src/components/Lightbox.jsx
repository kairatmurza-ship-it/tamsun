import { useEffect, useRef, useState } from "react";

export default function Lightbox() {
  const [photo, setPhoto] = useState(null);
  const closeRef = useRef(null);

  useEffect(() => {
    document.body.classList.toggle("photo-lightbox-open", Boolean(photo));
    if (photo) closeRef.current?.focus();
    return () => document.body.classList.remove("photo-lightbox-open");
  }, [photo]);

  useEffect(() => {
    function imageFromClick(target) {
      const zone = target.closest(".piece-photo, .hero-product, .order-visual, .cart-line-media");
      if (zone) return zone.querySelector("img");
      return target.closest(".chat-card img, .chat-sent-files img");
    }
    function onClick(event) {
      if (event.button !== 0) return;
      const img = imageFromClick(event.target);
      if (!img) return;
      const src = img.currentSrc || img.getAttribute("src");
      if (!src) return;
      event.preventDefault();
      event.stopPropagation();
      setPhoto({ src, alt: img.alt || "Фото" });
    }
    function onKey(event) {
      if (event.key === "Escape") setPhoto(null);
    }
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div
      className="photo-lightbox"
      hidden={!photo}
      role="dialog"
      aria-modal="true"
      aria-label="Увеличенное фото"
      onClick={(event) => {
        if (event.target === event.currentTarget || event.target.closest(".photo-lightbox-close")) setPhoto(null);
      }}
    >
      <button ref={closeRef} type="button" className="photo-lightbox-close" aria-label="Закрыть">
        ×
      </button>
      {photo ? <img src={photo.src} alt={photo.alt} /> : null}
    </div>
  );
}
