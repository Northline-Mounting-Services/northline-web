/** Coverage-map interaction only. Never fetches or filters Work records. */
const section = document.querySelector('[data-work-section]');

if (section) {
  const routeButtons = [...section.querySelectorAll('[data-route]')];
  const cityButtons = [...section.querySelectorAll('[data-city]')];
  const routePaths = [...section.querySelectorAll('.nl-map__route')];
  const nodes = [...section.querySelectorAll('.nl-map__node')];
  const cityItems = [...section.querySelectorAll('.nl-map__city')];

  const state = { routeId: null, citySlug: null };
  const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const routeOf = (cityButton) => cityButton.dataset.cityRoute;

  function paint(emphasisRouteId) {
    const active = emphasisRouteId || state.routeId;
    const scoped = Boolean(active);

    section.classList.toggle('is-emphasising', scoped);
    routePaths.forEach((path) => path.classList.toggle('is-emphasis', scoped && path.dataset.route === active));
    nodes.forEach((node) => {
      node.classList.toggle('is-emphasis', scoped && node.dataset.nodeRoute === active);
      node.classList.toggle('is-selected', Boolean(state.citySlug) && slug(node.dataset.nodeCity) === state.citySlug);
    });
    cityItems.forEach((item) => item.classList.toggle('is-emphasis', scoped && item.dataset.cityRoute === active));
  }

  function render() {
    routeButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.route === state.routeId)));
    cityButtons.forEach((button) => button.setAttribute('aria-pressed', String(slug(button.dataset.city) === state.citySlug)));
    paint(null);
  }

  section.addEventListener('click', (event) => {
    const route = event.target.closest('[data-route]');
    if (route) {
      const id = route.dataset.route;
      const same = state.routeId === id && !state.citySlug;
      state.routeId = same ? null : id;
      state.citySlug = null;
      render();
      return;
    }

    const city = event.target.closest('[data-city]');
    if (city) {
      const citySlug = slug(city.dataset.city);
      const same = state.citySlug === citySlug;
      state.citySlug = same ? null : citySlug;
      state.routeId = same ? null : routeOf(city);
      render();
    }
  });

  const emphasize = (id) => paint(id);

  section.addEventListener('pointerover', (event) => {
    const element = event.target.closest('[data-route], [data-city]');
    emphasize(element ? element.dataset.route || element.dataset.cityRoute : null);
  });

  section.addEventListener('pointerout', (event) => {
    if (!event.relatedTarget || !section.contains(event.relatedTarget)) emphasize(null);
  });

  section.addEventListener('focusin', (event) => {
    const element = event.target.closest('[data-route], [data-city]');
    emphasize(element ? element.dataset.route || element.dataset.cityRoute : null);
  });
}
