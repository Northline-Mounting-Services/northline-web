const reviewsRoot = document.querySelector("[data-google-reviews]");

if (reviewsRoot) {
  let loaded = false;

  async function loadGoogleReviews() {
    if (loaded) return;
    loaded = true;

    try {
      const response = await fetch("/api/google-reviews", {
        headers: { accept: "application/json" },
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(`Reviews request failed: ${response.status}`);
      }

      const data = await response.json();

      if (!data?.ok || !Array.isArray(data.reviews)) {
        throw new Error("Invalid reviews response");
      }

      const rating = reviewsRoot.querySelector("[data-google-rating]");
      const count = reviewsRoot.querySelector("[data-review-count]");
      const items = [...reviewsRoot.querySelectorAll("[data-review-item]")];

      if (rating && typeof data.rating === "number") {
        rating.textContent = data.rating.toFixed(1);
      }

      if (count && typeof data.reviewCount === "number") {
        count.textContent = String(data.reviewCount);
      }

      items.forEach((item, index) => {
        const review = data.reviews[index];

        if (!review) {
          item.hidden = true;
          return;
        }

        const text = item.querySelector("[data-review-text]");
        const author = item.querySelector("[data-review-author]");
        const time = item.querySelector("[data-review-time]");

        if (text) {
          text.textContent = review.text || "";
        }

        if (author) {
          author.textContent = review.author || "Google reviewer";

          const target =
            review.googleMapsUri ||
            review.authorUri;

          if (target) {
            author.href = target;
          } else {
            author.removeAttribute("href");
          }
        }

        if (time) {
          time.textContent = review.relativeTime || "";

          if (review.publishTime) {
            time.dateTime = review.publishTime;
          }
        }
      });

      const note = reviewsRoot.querySelector("[data-review-note]");

      if (note) {
        note.textContent =
          "Reviews provided by Google Maps · shown by Google relevance";
      }

      reviewsRoot.setAttribute("aria-busy", "false");
    } catch {
      reviewsRoot.hidden = true;
    }
  }

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;

        observer.disconnect();
        loadGoogleReviews();
      },
      {
        rootMargin: "500px 0px"
      }
    );

    observer.observe(reviewsRoot);
  } else {
    loadGoogleReviews();
  }
}
