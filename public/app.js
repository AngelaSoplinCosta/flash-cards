(() => {
  'use strict';

  const state = {
    decks: [],
    cards: [],
    studyQueue: [],
    studyIndex: 0,
  };

  const els = {
    themeToggle: document.getElementById('theme-toggle'),
    tabs: document.querySelectorAll('.tab-btn'),
    views: document.querySelectorAll('.view'),

    deckFilter: document.getElementById('deck-filter'),
    searchInput: document.getElementById('search-input'),
    newDeckBtn: document.getElementById('new-deck-btn'),
    newCardBtn: document.getElementById('new-card-btn'),
    cardList: document.getElementById('card-list'),
    emptyState: document.getElementById('empty-state'),

    studyDeckFilter: document.getElementById('study-deck-filter'),
    shuffleBtn: document.getElementById('shuffle-btn'),
    studyProgress: document.getElementById('study-progress'),
    studyEmpty: document.getElementById('study-empty'),
    studyArea: document.getElementById('study-area'),
    flashcard: document.getElementById('flashcard'),
    studyQuestion: document.getElementById('study-question'),
    studyAnswer: document.getElementById('study-answer'),
    prevBtn: document.getElementById('prev-btn'),
    flipBtn: document.getElementById('flip-btn'),
    nextBtn: document.getElementById('next-btn'),

    cardModal: document.getElementById('card-modal'),
    cardModalTitle: document.getElementById('card-modal-title'),
    cardForm: document.getElementById('card-form'),
    cardId: document.getElementById('card-id'),
    cardDeck: document.getElementById('card-deck'),
    cardQuestion: document.getElementById('card-question'),
    cardAnswer: document.getElementById('card-answer'),
    previewQuestion: document.getElementById('preview-question'),
    previewAnswer: document.getElementById('preview-answer'),
    cardCancelBtn: document.getElementById('card-cancel-btn'),

    deckModal: document.getElementById('deck-modal'),
    deckForm: document.getElementById('deck-form'),
    deckName: document.getElementById('deck-name'),
    deckCancelBtn: document.getElementById('deck-cancel-btn'),

    toast: document.getElementById('toast'),
  };

  // ---------- Markdown ----------

  function renderMarkdown(raw) {
    const html = marked.parse(raw || '', { breaks: true });
    return DOMPurify.sanitize(html);
  }

  // ---------- Utilities ----------

  let toastTimer = null;
  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 2500);
  }

  async function api(url, options = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (!res.ok) {
      let message = 'Ocurrió un error.';
      try {
        const body = await res.json();
        message = body.error || message;
      } catch (_) { /* no-op */ }
      throw new Error(message);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- Theme ----------

  function initTheme() {
    const saved = localStorage.getItem('flashcards-theme');
    const theme = saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    applyTheme(theme);
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('flashcards-theme', theme);
    els.themeToggle.textContent = theme === 'dark' ? '☀' : '☽';
  }

  els.themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });

  // ---------- Tabs ----------

  els.tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      els.tabs.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.dataset.view;
      els.views.forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
      if (view === 'study') startStudySession();
    });
  });

  // ---------- Decks ----------

  async function loadDecks() {
    state.decks = await api('/api/decks');
    populateDeckSelects();
  }

  function populateDeckSelects() {
    const optionsHtml = state.decks
      .map((d) => `<option value="${d.id}">${escapeHtml(d.name)} (${d.card_count ?? ''})</option>`)
      .join('');

    els.deckFilter.innerHTML = `<option value="">Todos los mazos</option>` + optionsHtml;
    els.studyDeckFilter.innerHTML = `<option value="">Todos los mazos</option>` +
      state.decks.map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
    els.cardDeck.innerHTML = state.decks
      .map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`)
      .join('');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  els.newDeckBtn.addEventListener('click', () => {
    els.deckName.value = '';
    els.deckModal.classList.remove('hidden');
    els.deckName.focus();
  });

  els.deckCancelBtn.addEventListener('click', () => els.deckModal.classList.add('hidden'));

  els.deckForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const deck = await api('/api/decks', {
        method: 'POST',
        body: JSON.stringify({ name: els.deckName.value.trim() }),
      });
      await loadDecks();
      els.deckFilter.value = deck.id;
      els.cardDeck.value = deck.id;
      els.deckModal.classList.add('hidden');
      showToast('Mazo creado.');
    } catch (err) {
      showToast(err.message);
    }
  });

  // ---------- Card list ----------

  async function loadCards() {
    const params = new URLSearchParams();
    if (els.deckFilter.value) params.set('deck_id', els.deckFilter.value);
    if (els.searchInput.value.trim()) params.set('q', els.searchInput.value.trim());
    state.cards = await api(`/api/cards?${params.toString()}`);
    renderCardList();
  }

  function deckName(id) {
    const deck = state.decks.find((d) => d.id === id);
    return deck ? deck.name : '';
  }

  function renderCardList() {
    els.cardList.innerHTML = '';
    els.emptyState.classList.toggle('hidden', state.cards.length > 0);

    for (const card of state.cards) {
      const item = document.createElement('div');
      item.className = 'card-item';
      item.innerHTML = `
        <div class="card-item-deck">${escapeHtml(deckName(card.deck_id))}</div>
        <div class="card-item-question markdown-body">${renderMarkdown(card.question)}</div>
        <div class="card-item-answer markdown-body">${renderMarkdown(card.answer)}</div>
        <div class="card-item-actions">
          <button class="btn btn-ghost" data-action="edit">Editar</button>
          <button class="btn btn-danger" data-action="delete">Eliminar</button>
        </div>
      `;
      item.querySelector('[data-action="edit"]').addEventListener('click', () => openCardModal(card));
      item.querySelector('[data-action="delete"]').addEventListener('click', () => deleteCard(card));
      els.cardList.appendChild(item);
    }
  }

  async function deleteCard(card) {
    if (!confirm('¿Eliminar esta tarjeta? Esta acción no se puede deshacer.')) return;
    try {
      await api(`/api/cards/${card.id}`, { method: 'DELETE' });
      showToast('Tarjeta eliminada.');
      await Promise.all([loadDecks(), loadCards()]);
    } catch (err) {
      showToast(err.message);
    }
  }

  els.deckFilter.addEventListener('change', loadCards);
  els.searchInput.addEventListener('input', debounce(loadCards, 250));

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  // ---------- Card modal ----------

  function openCardModal(card) {
    els.cardModalTitle.textContent = card ? 'Editar tarjeta' : 'Nueva tarjeta';
    els.cardId.value = card ? card.id : '';
    els.cardDeck.value = card ? card.deck_id : (els.deckFilter.value || state.decks[0]?.id || '');
    els.cardQuestion.value = card ? card.question : '';
    els.cardAnswer.value = card ? card.answer : '';
    updatePreviews();
    els.cardModal.classList.remove('hidden');
    els.cardQuestion.focus();
  }

  function updatePreviews() {
    els.previewQuestion.innerHTML = renderMarkdown(els.cardQuestion.value);
    els.previewAnswer.innerHTML = renderMarkdown(els.cardAnswer.value);
  }

  els.cardQuestion.addEventListener('input', updatePreviews);
  els.cardAnswer.addEventListener('input', updatePreviews);

  els.newCardBtn.addEventListener('click', () => openCardModal(null));
  els.cardCancelBtn.addEventListener('click', () => els.cardModal.classList.add('hidden'));

  els.cardForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      deck_id: Number(els.cardDeck.value),
      question: els.cardQuestion.value.trim(),
      answer: els.cardAnswer.value.trim(),
    };
    try {
      if (els.cardId.value) {
        await api(`/api/cards/${els.cardId.value}`, { method: 'PUT', body: JSON.stringify(payload) });
        showToast('Tarjeta actualizada.');
      } else {
        await api('/api/cards', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Tarjeta creada.');
      }
      els.cardModal.classList.add('hidden');
      await Promise.all([loadDecks(), loadCards()]);
    } catch (err) {
      showToast(err.message);
    }
  });

  // ---------- Study mode ----------

  async function startStudySession() {
    const params = new URLSearchParams();
    if (els.studyDeckFilter.value) params.set('deck_id', els.studyDeckFilter.value);
    const cards = await api(`/api/cards?${params.toString()}`);
    state.studyQueue = cards;
    state.studyIndex = 0;
    renderStudyCard();
  }

  function renderStudyCard() {
    const total = state.studyQueue.length;
    els.flashcard.classList.remove('flipped');

    if (total === 0) {
      els.studyEmpty.classList.remove('hidden');
      els.studyArea.classList.add('hidden');
      els.studyProgress.textContent = '';
      return;
    }

    els.studyEmpty.classList.add('hidden');
    els.studyArea.classList.remove('hidden');

    const card = state.studyQueue[state.studyIndex];
    els.studyQuestion.innerHTML = renderMarkdown(card.question);
    els.studyAnswer.innerHTML = renderMarkdown(card.answer);
    els.studyProgress.textContent = `${state.studyIndex + 1} / ${total}`;
  }

  function flipCard() {
    if (state.studyQueue.length === 0) return;
    els.flashcard.classList.toggle('flipped');
  }

  function goTo(delta) {
    const total = state.studyQueue.length;
    if (total === 0) return;
    state.studyIndex = (state.studyIndex + delta + total) % total;
    renderStudyCard();
  }

  els.flashcard.addEventListener('click', flipCard);
  els.flipBtn.addEventListener('click', flipCard);
  els.prevBtn.addEventListener('click', () => goTo(-1));
  els.nextBtn.addEventListener('click', () => goTo(1));
  els.studyDeckFilter.addEventListener('change', startStudySession);

  els.shuffleBtn.addEventListener('click', () => {
    if (state.studyQueue.length === 0) return;
    state.studyQueue = shuffle(state.studyQueue);
    state.studyIndex = 0;
    renderStudyCard();
    showToast('Tarjetas mezcladas.');
  });

  document.addEventListener('keydown', (e) => {
    if (!document.getElementById('view-study').classList.contains('active')) return;
    if (e.target.matches('input, textarea')) return;
    if (e.key === 'ArrowRight') goTo(1);
    else if (e.key === 'ArrowLeft') goTo(-1);
    else if (e.key === ' ') { e.preventDefault(); flipCard(); }
  });

  // ---------- Init ----------

  initTheme();
  (async function init() {
    await loadDecks();
    await loadCards();
  })();
})();
