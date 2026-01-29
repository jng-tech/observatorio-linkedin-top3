(async function () {
  const postsContainer = document.getElementById('posts-container');
  const lastUpdatedEl = document.getElementById('last-updated');
  const keywordsEl = document.getElementById('keywords');

  try {
    const response = await fetch('/data.json', { cache: 'no-store' });

    if (!response.ok) {
      throw new Error('Error al cargar datos');
    }

    const data = await response.json();

    // Renderizar metadata
    if (data.lastUpdated) {
      const date = new Date(data.lastUpdated);
      lastUpdatedEl.textContent = date.toLocaleString('es-ES', {
        dateStyle: 'long',
        timeStyle: 'short'
      });
    } else {
      lastUpdatedEl.textContent = 'Sin datos';
    }

    if (data.keywords && data.keywords.length > 0) {
      keywordsEl.textContent = data.keywords.join(', ');
    }

    // Renderizar posts (máximo 3)
    const posts = data.posts || [];

    if (posts.length === 0) {
      postsContainer.innerHTML = `
        <div class="empty-state">
          <p>No hay publicaciones disponibles todavía.</p>
          <p class="empty-hint">Los datos se actualizarán próximamente.</p>
        </div>
      `;
      return;
    }

    const top3 = posts.slice(0, 3);
    postsContainer.innerHTML = top3.map((post, index) => renderCard(post, index + 1)).join('');

  } catch (error) {
    console.error('Error:', error);
    postsContainer.innerHTML = `
      <div class="error-state">
        <p>Error al cargar las publicaciones.</p>
        <p class="error-hint">${escapeHtml(error.message)}</p>
      </div>
    `;
  }
})();

function renderCard(post, rank) {
  const snippet = truncateText(post.content || post.snippet || '', 240);
  const total = (post.likes || 0) + (post.comments || 0) + (post.reposts || 0);
  const author = post.author || post.title || 'Autor desconocido';

  return `
    <article class="post-card" data-rank="${rank}">
      <div class="card-header">
        <span class="rank">#${rank}</span>
        <h2 class="author">${escapeHtml(author)}</h2>
      </div>

      <p class="snippet">${escapeHtml(snippet)}</p>

      <div class="metrics">
        <div class="metric">
          <span class="metric-value">${formatNumber(post.likes || 0)}</span>
          <span class="metric-label">Likes</span>
        </div>
        <div class="metric">
          <span class="metric-value">${formatNumber(post.comments || 0)}</span>
          <span class="metric-label">Comments</span>
        </div>
        <div class="metric">
          <span class="metric-value">${formatNumber(post.reposts || 0)}</span>
          <span class="metric-label">Reposts</span>
        </div>
        <div class="metric metric-total">
          <span class="metric-value">${formatNumber(total)}</span>
          <span class="metric-label">Total</span>
        </div>
      </div>

      ${post.url ? `
        <a href="${escapeHtml(post.url)}" target="_blank" rel="noopener noreferrer" class="btn-view">
          Ver publicación original
        </a>
      ` : ''}
    </article>
  `;
}

function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength).trim() + '...';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}
