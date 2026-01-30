// LinkedIn-style Observatorio ESG App

(async function () {
  const feedContent = document.getElementById('feed-content');
  const lastUpdatedEl = document.getElementById('last-updated');
  const sidebarTotal = document.getElementById('sidebar-total');
  const sidebarDays = document.getElementById('sidebar-days');
  const totalPostsBadge = document.getElementById('total-posts-badge');
  const keywordsList = document.getElementById('keywords-list');
  const tabButtons = document.querySelectorAll('.tab-btn');

  let todayData = null;
  let historyData = null;
  let top10Data = null;
  let currentTab = 'today';

  // Initialize
  await loadAllData();
  setupTabs();

  async function loadAllData() {
    try {
      // Load all data files in parallel
      const [todayRes, historyRes, top10Res] = await Promise.all([
        fetch('/data.json', { cache: 'no-store' }).catch(() => null),
        fetch('/history.json', { cache: 'no-store' }).catch(() => null),
        fetch('/top10.json', { cache: 'no-store' }).catch(() => null)
      ]);

      if (todayRes && todayRes.ok) {
        todayData = await todayRes.json();
      }
      if (historyRes && historyRes.ok) {
        historyData = await historyRes.json();
      }
      if (top10Res && top10Res.ok) {
        top10Data = await top10Res.json();
      }

      updateMetadata();
      renderCurrentTab();
    } catch (error) {
      console.error('Error loading data:', error);
      showError(error.message);
    }
  }

  function updateMetadata() {
    // Update last updated
    if (todayData && todayData.lastUpdated) {
      const date = new Date(todayData.lastUpdated);
      lastUpdatedEl.textContent = date.toLocaleString('es-ES', {
        dateStyle: 'long',
        timeStyle: 'short'
      });
    }

    // Update sidebar stats
    let totalPosts = 0;
    let uniqueDays = new Set();

    // Handle both array format and object with entries format
    if (historyData) {
      const posts = Array.isArray(historyData) ? historyData : (historyData.entries || []);
      if (Array.isArray(posts)) {
        totalPosts = posts.length;
        posts.forEach(post => {
          if (post.date) uniqueDays.add(post.date);
        });
      }
    } else if (todayData && todayData.posts) {
      totalPosts = todayData.posts.length;
      uniqueDays.add(todayData.date);
    }

    sidebarTotal.textContent = totalPosts;
    sidebarDays.textContent = uniqueDays.size;
    totalPostsBadge.textContent = `${totalPosts} posts`;

    // Update keywords
    if (todayData && todayData.keywords) {
      keywordsList.innerHTML = todayData.keywords
        .map(kw => `<span class="keyword-tag">${escapeHtml(kw)}</span>`)
        .join('');
    }
  }

  function setupTabs() {
    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        tabButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentTab = btn.dataset.tab;
        renderCurrentTab();
      });
    });
  }

  function renderCurrentTab() {
    switch (currentTab) {
      case 'today':
        renderTodayTop3();
        break;
      case 'feed':
        renderHistoryFeed();
        break;
      case 'top10':
        renderTop10();
        break;
    }
  }

  function renderTodayTop3() {
    if (!todayData || !todayData.posts || todayData.posts.length === 0) {
      feedContent.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/>
          </svg>
          <h3>No hay posts de hoy</h3>
          <p>Los datos se actualizaran proximamente.</p>
        </div>
      `;
      return;
    }

    const dateStr = todayData.date ? formatDate(todayData.date) : 'Hoy';

    feedContent.innerHTML = `
      <div class="top3-header">
        <h2>Top 3 del dia</h2>
        <p>${dateStr}</p>
      </div>
      ${todayData.posts.slice(0, 3).map((post, i) => renderPostCard(post, i + 1, true)).join('')}
    `;
  }

  function renderHistoryFeed() {
    // Handle both array format and object with entries format
    const posts = historyData ? (Array.isArray(historyData) ? historyData : (historyData.entries || [])) : [];

    if (!posts || posts.length === 0) {
      feedContent.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/>
          </svg>
          <h3>Sin historial</h3>
          <p>El historial de publicaciones aparecera aqui.</p>
        </div>
      `;
      return;
    }

    // Group posts by date
    const postsByDate = {};
    posts.forEach(post => {
      const date = post.date || 'Sin fecha';
      if (!postsByDate[date]) {
        postsByDate[date] = [];
      }
      postsByDate[date].push(post);
    });

    // Sort dates (newest first)
    const sortedDates = Object.keys(postsByDate).sort((a, b) =>
      new Date(b) - new Date(a)
    );

    let html = '';
    sortedDates.forEach(date => {
      const datePosts = postsByDate[date];

      // Sort posts within each day by total engagement
      datePosts.sort((a, b) => (b.total || 0) - (a.total || 0));

      html += `
        <div class="date-separator">
          <span class="date-label">${formatDate(date)}</span>
        </div>
      `;

      datePosts.forEach((post, i) => {
        html += renderPostCard(post, i + 1, false);
      });
    });

    feedContent.innerHTML = html || `
      <div class="empty-state">
        <h3>Sin publicaciones</h3>
        <p>No hay publicaciones en el historial.</p>
      </div>
    `;
  }

  function renderTop10() {
    // Handle both array format and object with posts format
    const posts = top10Data ? (Array.isArray(top10Data) ? top10Data : (top10Data.posts || [])) : [];

    if (!posts || posts.length === 0) {
      feedContent.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
          </svg>
          <h3>Top 10 no disponible</h3>
          <p>El ranking all-time aparecera aqui.</p>
        </div>
      `;
      return;
    }

    feedContent.innerHTML = `
      <div class="top3-header" style="background: linear-gradient(135deg, #057642, #0a66c2);">
        <h2>Top 10 All-Time</h2>
        <p>Las publicaciones con mas engagement</p>
      </div>
      ${posts.slice(0, 10).map((post, i) => renderPostCard(post, i + 1, true, true)).join('')}
    `;
  }

  function renderPostCard(post, rank, showRank = false, isTop10 = false) {
    const author = post.author || post.title || 'Autor desconocido';
    const initials = getInitials(author);
    const snippet = truncateText(post.content || post.snippet || '', 280);
    const total = (post.likes || 0) + (post.comments || 0) + (post.reposts || 0);
    const keyword = post.keyword || '';
    const verified = post.verified;

    const rankBadgeClass = rank <= 3 ? `rank-${rank}` : '';
    const cardClass = isTop10 ? 'post-card top10-card' : 'post-card';

    return `
      <article class="${cardClass} ${rankBadgeClass}">
        <div class="post-card-wrapper">
          ${showRank ? `
            <div class="rank-badge">
              <div class="rank-badge-inner">${rank}</div>
            </div>
          ` : ''}

          <div class="post-header">
            <div class="post-avatar" style="background: ${getAvatarGradient(author)}">
              ${initials}
            </div>
            <div class="post-meta">
              <div class="post-author">
                ${escapeHtml(author)}
                ${verified ? `
                  <svg class="verified-badge" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                  </svg>
                ` : ''}
              </div>
              <div class="post-info">
                ${keyword ? `<span class="post-keyword">${escapeHtml(keyword)}</span>` : ''}
              </div>
            </div>
          </div>

          <div class="post-content">
            <p class="post-snippet">${escapeHtml(snippet)}</p>
          </div>

          <div class="post-stats">
            <span class="stat-item likes">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/>
              </svg>
              ${formatNumber(post.likes || 0)}
            </span>
            <span class="stat-item comments">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18z"/>
              </svg>
              ${formatNumber(post.comments || 0)}
            </span>
            <span class="stat-item reposts">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
              </svg>
              ${formatNumber(post.reposts || 0)}
            </span>
            <span class="stat-total">${formatNumber(total)} total</span>
          </div>

          <div class="post-actions">
            ${post.url ? `
              <a href="${escapeHtml(post.url)}" target="_blank" rel="noopener noreferrer" class="btn-view">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>
                </svg>
                Ver en LinkedIn
              </a>
            ` : ''}
          </div>
        </div>
      </article>
    `;
  }

  function getInitials(name) {
    if (!name) return '?';
    const parts = name.split(' ').filter(p => p.length > 0);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function getAvatarGradient(name) {
    // Generate consistent color based on name
    const colors = [
      'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
      'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
      'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
      'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
      'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
      'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)'
    ];
    const hash = name ? name.split('').reduce((a, b) => a + b.charCodeAt(0), 0) : 0;
    return colors[hash % colors.length];
  }

  function formatDate(dateStr) {
    try {
      const date = new Date(dateStr + 'T00:00:00');
      return date.toLocaleDateString('es-ES', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch {
      return dateStr;
    }
  }

  function truncateText(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
  }

  function escapeHtml(text) {
    if (!text) return '';
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

  function showError(message) {
    feedContent.innerHTML = `
      <div class="error-state">
        <h3>Error al cargar</h3>
        <p>${escapeHtml(message)}</p>
      </div>
    `;
  }
})();
