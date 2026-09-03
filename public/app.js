(() => {
  'use strict';

  const state = {
    decks: [],
    tags: [],
    cards: [],
    selectedCardTagIds: new Set(),
    selectCreatedTagForCard: false,
    studyQueue: [],
    studyIndex: 0,
  };

  const els = {
    themeToggle: document.getElementById('theme-toggle'),
    tabs: document.querySelectorAll('.tab-btn'),
    views: document.querySelectorAll('.view'),

    deckFilter: document.getElementById('deck-filter'),
    tagFilter: document.getElementById('tag-filter'),
    searchInput: document.getElementById('search-input'),
    newTagBtn: document.getElementById('new-tag-btn'),
    newDeckBtn: document.getElementById('new-deck-btn'),
    editDeckBtn: document.getElementById('edit-deck-btn'),
    newCardBtn: document.getElementById('new-card-btn'),
    cardList: document.getElementById('card-list'),
    emptyState: document.getElementById('empty-state'),

    studyDeckFilter: document.getElementById('study-deck-filter'),
    studyTagFilter: document.getElementById('study-tag-filter'),
    shuffleBtn: document.getElementById('shuffle-btn'),
    studyProgress: document.getElementById('study-progress'),
    studyEmpty: document.getElementById('study-empty'),
    studyArea: document.getElementById('study-area'),
    flashcard: document.getElementById('flashcard'),
    flashcardBack: document.querySelector('.flashcard-back'),
    answerExpandBtn: document.getElementById('answer-expand-btn'),
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
    cardTagPicker: document.getElementById('card-tag-picker'),
    cardNewTagBtn: document.getElementById('card-new-tag-btn'),
    cardSelectedTags: document.getElementById('card-selected-tags'),
    cardQuestion: document.getElementById('card-question'),
    cardAnswer: document.getElementById('card-answer'),
    previewQuestion: document.getElementById('preview-question'),
    previewAnswer: document.getElementById('preview-answer'),
    cardCancelBtn: document.getElementById('card-cancel-btn'),

    deckModal: document.getElementById('deck-modal'),
    deckModalTitle: document.getElementById('deck-modal-title'),
    deckForm: document.getElementById('deck-form'),
    deckId: document.getElementById('deck-id'),
    deckName: document.getElementById('deck-name'),
    deckDeleteBtn: document.getElementById('deck-delete-btn'),
    deckSaveBtn: document.getElementById('deck-save-btn'),
    deckCancelBtn: document.getElementById('deck-cancel-btn'),

    tagModal: document.getElementById('tag-modal'),
    tagForm: document.getElementById('tag-form'),
    tagName: document.getElementById('tag-name'),
    tagCancelBtn: document.getElementById('tag-cancel-btn'),

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
    const selectedDeck = els.deckFilter.value;
    const selectedStudyDeck = els.studyDeckFilter.value;
    const optionsHtml = state.decks
      .map((d) => `<option value="${d.id}">${escapeHtml(d.name)} (${d.card_count ?? ''})</option>`)
      .join('');

    els.deckFilter.innerHTML = `<option value="">Todos los mazos</option>` + optionsHtml;
    els.studyDeckFilter.innerHTML = `<option value="">Todos los mazos</option>` +
      state.decks.map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
    els.cardDeck.innerHTML = state.decks
      .map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`)
      .join('');
    els.deckFilter.value = selectedDeck;
    els.studyDeckFilter.value = selectedStudyDeck;
    updateDeckEditButton();
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  els.newDeckBtn.addEventListener('click', () => {
    els.deckModalTitle.textContent = 'Nuevo mazo';
    els.deckId.value = '';
    els.deckName.value = '';
    els.deckDeleteBtn.classList.add('hidden');
    els.deckSaveBtn.textContent = 'Crear';
    els.deckModal.classList.remove('hidden');
    els.deckName.focus();
  });

  function updateDeckEditButton() {
    const hasSelectedDeck = Boolean(els.deckFilter.value);
    els.editDeckBtn.disabled = !hasSelectedDeck;
    els.editDeckBtn.title = hasSelectedDeck
      ? 'Renombrar o eliminar el mazo seleccionado'
      : 'Selecciona un mazo para editarlo';
  }

  els.editDeckBtn.addEventListener('click', () => {
    const deck = state.decks.find((item) => item.id === Number(els.deckFilter.value));
    if (!deck) return;

    els.deckModalTitle.textContent = 'Editar mazo';
    els.deckId.value = deck.id;
    els.deckName.value = deck.name;
    els.deckDeleteBtn.classList.remove('hidden');
    els.deckDeleteBtn.disabled = state.decks.length <= 1;
    els.deckDeleteBtn.title = state.decks.length <= 1
      ? 'Debe existir al menos un mazo'
      : `Eliminar ${deck.name}`;
    els.deckSaveBtn.textContent = 'Guardar';
    els.deckModal.classList.remove('hidden');
    els.deckName.focus();
    els.deckName.select();
  });

  els.deckCancelBtn.addEventListener('click', () => els.deckModal.classList.add('hidden'));

  els.deckForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const name = els.deckName.value.trim();
      const editingDeckId = els.deckId.value;

      if (editingDeckId) {
        await api(`/api/decks/${editingDeckId}`, {
          method: 'PUT',
          body: JSON.stringify({ name }),
        });
        await loadDecks();
        await loadCards();
        showToast('Mazo actualizado.');
      } else {
        const deck = await api('/api/decks', {
          method: 'POST',
          body: JSON.stringify({ name }),
        });
        await loadDecks();
        els.deckFilter.value = deck.id;
        els.cardDeck.value = deck.id;
        updateDeckEditButton();
        await loadCards();
        showToast('Mazo creado.');
      }

      els.deckModal.classList.add('hidden');
    } catch (err) {
      showToast(err.message);
    }
  });

  els.deckDeleteBtn.addEventListener('click', async () => {
    const deck = state.decks.find((item) => item.id === Number(els.deckId.value));
    if (!deck) return;

    const cardLabel = deck.card_count === 1 ? 'su 1 tarjeta' : `sus ${deck.card_count} tarjetas`;
    if (!confirm(`¿Eliminar el mazo "${deck.name}"? También se eliminarán ${cardLabel}. Esta acción no se puede deshacer.`)) return;

    try {
      await api(`/api/decks/${deck.id}`, { method: 'DELETE' });
      if (els.deckFilter.value === String(deck.id)) els.deckFilter.value = '';
      if (els.studyDeckFilter.value === String(deck.id)) els.studyDeckFilter.value = '';
      els.deckModal.classList.add('hidden');
      await Promise.all([loadDecks(), loadTags()]);
      await loadCards();
      showToast('Mazo eliminado.');
    } catch (err) {
      showToast(err.message);
    }
  });

  // ---------- Tags ----------

  async function loadTags() {
    try {
      state.tags = await api('/api/tags');
      populateTagSelects();
    } catch (err) {
      state.tags = [];
      populateTagSelects();
      throw err;
    }
  }

  function populateTagSelects() {
    const selectedTag = els.tagFilter.value;
    const selectedStudyTag = els.studyTagFilter.value;
    const optionsHtml = state.tags
      .map((tag) => `<option value="${tag.id}">${escapeHtml(tag.name)} (${tag.card_count})</option>`)
      .join('');

    els.tagFilter.innerHTML = '<option value="">Todas las etiquetas</option>' + optionsHtml;
    els.studyTagFilter.innerHTML = '<option value="">Todas las etiquetas</option>' + optionsHtml;
    els.tagFilter.value = selectedTag;
    els.studyTagFilter.value = selectedStudyTag;
    populateCardTagPicker();
  }

  function populateCardTagPicker() {
    const availableTags = state.tags.filter((tag) => !state.selectedCardTagIds.has(tag.id));
    const placeholder = state.tags.length === 0
      ? 'Primero crea una etiqueta'
      : 'Selecciona una etiqueta...';
    els.cardTagPicker.innerHTML = `<option value="">${placeholder}</option>` + availableTags
      .map((tag) => `<option value="${tag.id}">${escapeHtml(tag.name)}</option>`)
      .join('');
    els.cardTagPicker.disabled = state.tags.length === 0;
  }

  function renderSelectedCardTags() {
    els.cardSelectedTags.innerHTML = '';
    const selectedTags = state.tags.filter((tag) => state.selectedCardTagIds.has(tag.id));

    if (selectedTags.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'tag-chips-empty';
      empty.textContent = 'Sin etiquetas seleccionadas';
      els.cardSelectedTags.appendChild(empty);
    }

    for (const tag of selectedTags) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tag-chip tag-chip-removable';
      chip.textContent = `${tag.name} ×`;
      chip.setAttribute('aria-label', `Quitar etiqueta ${tag.name}`);
      chip.addEventListener('click', () => {
        state.selectedCardTagIds.delete(tag.id);
        renderSelectedCardTags();
        populateCardTagPicker();
      });
      els.cardSelectedTags.appendChild(chip);
    }
  }

  els.cardTagPicker.addEventListener('change', () => {
    const tagId = Number(els.cardTagPicker.value);
    if (!tagId) return;
    state.selectedCardTagIds.add(tagId);
    renderSelectedCardTags();
    populateCardTagPicker();
  });

  function openTagModal(selectForCard) {
    state.selectCreatedTagForCard = selectForCard;
    els.tagName.value = '';
    els.tagModal.classList.remove('hidden');
    els.tagName.focus();
  }

  els.newTagBtn.addEventListener('click', () => {
    openTagModal(false);
  });

  els.cardNewTagBtn.addEventListener('click', () => {
    openTagModal(true);
  });

  els.tagCancelBtn.addEventListener('click', () => {
    const returnToCard = state.selectCreatedTagForCard;
    state.selectCreatedTagForCard = false;
    els.tagModal.classList.add('hidden');
    if (returnToCard) els.cardTagPicker.focus();
  });

  els.tagForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const tag = await api('/api/tags', {
        method: 'POST',
        body: JSON.stringify({ name: els.tagName.value.trim() }),
      });
      await loadTags();
      const selectForCard = state.selectCreatedTagForCard;
      if (selectForCard) {
        state.selectedCardTagIds.add(Number(tag.id));
        renderSelectedCardTags();
        populateCardTagPicker();
      }
      state.selectCreatedTagForCard = false;
      els.tagModal.classList.add('hidden');
      showToast('Etiqueta creada.');
      if (selectForCard) els.cardTagPicker.focus();
    } catch (err) {
      showToast(err.message);
    }
  });

  // ---------- Card list ----------

  async function loadCards() {
    const params = new URLSearchParams();
    if (els.deckFilter.value) params.set('deck_id', els.deckFilter.value);
    if (els.tagFilter.value) params.set('tag_id', els.tagFilter.value);
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
    const hasFilters = els.deckFilter.value || els.tagFilter.value || els.searchInput.value.trim();
    els.emptyState.textContent = hasFilters
      ? 'No hay tarjetas que coincidan con los filtros.'
      : 'No hay tarjetas todavía. Crea la primera con "+ Tarjeta".';

    for (const card of state.cards) {
      const item = document.createElement('div');
      item.className = 'card-item';
      item.innerHTML = `
        <div class="card-item-deck">${escapeHtml(deckName(card.deck_id))}</div>
        <div class="tag-chips">
          ${(card.tags || []).map((tag) => `
            <button type="button" class="tag-chip" data-tag-id="${tag.id}">${escapeHtml(tag.name)}</button>
          `).join('')}
        </div>
        <div class="card-item-question markdown-body">${renderMarkdown(card.question)}</div>
        <div class="card-item-answer markdown-body">${renderMarkdown(card.answer)}</div>
        <div class="card-item-actions">
          <button class="btn btn-ghost" data-action="edit">Editar</button>
          <button class="btn btn-danger" data-action="delete">Eliminar</button>
        </div>
      `;
      item.querySelector('[data-action="edit"]').addEventListener('click', () => openCardModal(card));
      item.querySelector('[data-action="delete"]').addEventListener('click', () => deleteCard(card));
      item.querySelectorAll('[data-tag-id]').forEach((chip) => {
        chip.addEventListener('click', () => {
          els.tagFilter.value = chip.dataset.tagId;
          loadCards();
        });
      });
      els.cardList.appendChild(item);
    }
  }

  async function deleteCard(card) {
    if (!confirm('¿Eliminar esta tarjeta? Esta acción no se puede deshacer.')) return;
    try {
      await api(`/api/cards/${card.id}`, { method: 'DELETE' });
      showToast('Tarjeta eliminada.');
      await Promise.all([loadDecks(), loadTags(), loadCards()]);
    } catch (err) {
      showToast(err.message);
    }
  }

  els.deckFilter.addEventListener('change', () => {
    updateDeckEditButton();
    loadCards();
  });
  els.tagFilter.addEventListener('change', loadCards);
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
    state.selectedCardTagIds = new Set(card ? (card.tags || []).map((tag) => tag.id) : []);
    renderSelectedCardTags();
    populateCardTagPicker();
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
      tags: state.tags
        .filter((tag) => state.selectedCardTagIds.has(tag.id))
        .map((tag) => tag.name),
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
      await Promise.all([loadDecks(), loadTags(), loadCards()]);
    } catch (err) {
      showToast(err.message);
    }
  });

  // ---------- Study mode ----------

  async function startStudySession() {
    const params = new URLSearchParams();
    if (els.studyDeckFilter.value) params.set('deck_id', els.studyDeckFilter.value);
    if (els.studyTagFilter.value) params.set('tag_id', els.studyTagFilter.value);
    const cards = await api(`/api/cards?${params.toString()}`);
    state.studyQueue = cards;
    state.studyIndex = 0;
    renderStudyCard();
  }

  function renderStudyCard() {
    const total = state.studyQueue.length;
    els.flashcard.classList.remove('flipped', 'expanded');
    els.flashcard.style.height = '';
    els.answerExpandBtn.setAttribute('aria-expanded', 'false');
    els.answerExpandBtn.setAttribute('aria-label', 'Ampliar respuesta');
    els.answerExpandBtn.title = 'Ampliar respuesta';

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
    const showingAnswer = !els.flashcard.classList.contains('flipped');

    if (showingAnswer) {
      els.flashcard.classList.add('flipped');
    } else {
      els.flashcard.classList.remove('flipped');
      setAnswerExpanded(false);
    }
  }

  function setAnswerExpanded(expanded) {
    els.flashcard.classList.toggle('expanded', expanded);
    els.answerExpandBtn.setAttribute('aria-expanded', String(expanded));
    els.answerExpandBtn.setAttribute(
      'aria-label',
      expanded ? 'Reducir respuesta' : 'Ampliar respuesta'
    );
    els.answerExpandBtn.title = expanded ? 'Reducir respuesta' : 'Ampliar respuesta';
    els.flashcard.style.height = expanded ? `${els.flashcardBack.offsetHeight}px` : '';
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
  els.studyTagFilter.addEventListener('change', startStudySession);
  els.answerExpandBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    setAnswerExpanded(!els.flashcard.classList.contains('expanded'));
  });

  window.addEventListener('resize', () => {
    if (els.flashcard.classList.contains('expanded')) {
      els.flashcard.style.height = `${els.flashcardBack.offsetHeight}px`;
    }
  });

  els.shuffleBtn.addEventListener('click', () => {
    if (state.studyQueue.length === 0) return;
    state.studyQueue = shuffle(state.studyQueue);
    state.studyIndex = 0;
    renderStudyCard();
    showToast('Tarjetas mezcladas.');
  });

  document.addEventListener('keydown', (e) => {
    if (!document.getElementById('view-study').classList.contains('active')) return;
    if (e.target.matches('input, textarea, button, select')) return;
    if (e.key === 'ArrowRight') goTo(1);
    else if (e.key === 'ArrowLeft') goTo(-1);
    else if (e.key === ' ') { e.preventDefault(); flipCard(); }
  });

  // ---------- Init ----------

  initTheme();
  (async function init() {
    const results = await Promise.allSettled([loadDecks(), loadTags()]);
    if (results.some((result) => result.status === 'rejected')) {
      showToast('No se pudieron cargar todos los datos. Reinicia el servidor.');
    }
    try {
      await loadCards();
    } catch (err) {
      showToast(err.message);
    }
  })();
})();
