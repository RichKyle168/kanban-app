/**
 * 暖光看板 (Minimalist Kanban Board)
 * 功能：三欄看板 (To-do, Process, Done)、跨欄拖曳、分類/負責人、排程到期日、Google 日曆一鍵同步
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'minimalist_kanban_todos_v3';
  const PREV_STORAGE_KEY_V2 = 'minimalist_kanban_todos_v2';
  const PREV_STORAGE_KEY_V1 = 'minimalist_todos_v1';

  // 輔助產生示範日期 (明天下午 14:00)
  function getSampleDueDate(hoursFromNow) {
    const d = new Date(Date.now() + hoursFromNow * 3600000);
    d.setMinutes(0, 0, 0);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  // 預設示範資料
  const DEFAULT_TODOS = [
    {
      id: 'demo_1',
      text: '準備專案行銷報告與時程規劃',
      assignee: 'Alex',
      category: 'work',
      status: 'todo',
      dueDate: getSampleDueDate(26), // 預設附帶明日排程
      createdAt: Date.now() - 3600000 * 3
    },
    {
      id: 'demo_2',
      text: '採買新鮮燕麥奶與淺焙咖啡豆',
      assignee: '自己',
      category: 'life',
      status: 'process',
      dueDate: '',
      createdAt: Date.now() - 3600000 * 2
    },
    {
      id: 'demo_3',
      text: '晨間閱讀 20 分鐘與伸展放鬆',
      assignee: '',
      category: 'life',
      status: 'done',
      dueDate: '',
      createdAt: Date.now() - 3600000 * 5
    }
  ];

  // 狀態管理
  let todos = [];
  let currentCategoryFilter = 'all'; // 'all' | 'work' | 'life'
  let draggedTodoId = null;

  // DOM 元素快取
  const todoForm = document.getElementById('todoForm');
  const todoInput = document.getElementById('todoInput');
  const assigneeInput = document.getElementById('assigneeInput');
  const dueDateInput = document.getElementById('dueDateInput');
  const currentDateTextEl = document.getElementById('currentDateText');
  const filterTabs = document.querySelectorAll('.filter-tabs .tab-btn');
  const clearDoneBtn = document.getElementById('clearDoneBtn');

  // 看板計數徽章
  const countAllEl = document.getElementById('countAll');
  const countWorkEl = document.getElementById('countWork');
  const countLifeEl = document.getElementById('countLife');
  const badgeCountTodo = document.getElementById('badgeCountTodo');
  const badgeCountProcess = document.getElementById('badgeCountProcess');
  const badgeCountDone = document.getElementById('badgeCountDone');

  // 三欄列表容器
  const listTodo = document.getElementById('list-todo');
  const listProcess = document.getElementById('list-process');
  const listDone = document.getElementById('list-done');
  const dropzones = document.querySelectorAll('.kanban-dropzone');

  // 初始化入口
  function init() {
    updateDateDisplay();
    loadTodos();
    bindFormAndFilterEvents();
    bindDropzoneEvents();
    render();
  }

  // 載入本地儲存 (向下相容舊版結構)
  function loadTodos() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        todos = JSON.parse(stored);
      } else {
        // 嘗試遷移 v2 或 v1 資料
        const storedV2 = localStorage.getItem(PREV_STORAGE_KEY_V2) || localStorage.getItem(PREV_STORAGE_KEY_V1);
        if (storedV2) {
          const prevItems = JSON.parse(storedV2);
          todos = prevItems.map(item => ({
            id: item.id || 'card_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            text: item.text || '',
            assignee: item.assignee || '',
            category: item.category || 'work',
            status: item.status ? item.status : (item.completed ? 'done' : 'todo'),
            dueDate: item.dueDate || '',
            createdAt: item.createdAt || Date.now()
          }));
          saveTodos();
        } else {
          todos = [...DEFAULT_TODOS];
          saveTodos();
        }
      }
    } catch (e) {
      console.error('讀取 LocalStorage 失敗:', e);
      todos = [...DEFAULT_TODOS];
    }
  }

  // 保存至本地儲存
  function saveTodos() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
    } catch (e) {
      console.error('儲存至 LocalStorage 失敗:', e);
    }
  }

  // 格式化今日日期
  function updateDateDisplay() {
    if (!currentDateTextEl) return;
    const now = new Date();
    const days = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const date = now.getDate();
    const dayName = days[now.getDay()];
    currentDateTextEl.textContent = `${year}年${month}月${date}日 · ${dayName}`;
  }

  // 安全跳脫 HTML 避免 XSS
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // 格式化卡片顯示用日期 (例如: 9/6 14:00)
  function formatFriendlyDueDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const month = d.getMonth() + 1;
    const date = d.getDate();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${month}/${date} ${hours}:${minutes}`;
  }

  // ==========================================================================
  // Google 日曆整合 (Web Intent URL 產生器)
  // ==========================================================================

  function formatGCalDate(date) {
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  }

  function createGoogleCalendarUrl(todo) {
    const title = encodeURIComponent(todo.text);
    let details = `【暖光看板待辦事項】\n`;
    details += `• 分類：${todo.category === 'work' ? '工作' : '生活'}\n`;
    if (todo.assignee) details += `• 負責人：${todo.assignee}\n`;
    details += `• 看板狀態：${todo.status === 'todo' ? 'To-do (待處理)' : todo.status === 'process' ? 'Process (進行中)' : 'Done (已完成)'}\n`;
    details += `\n來自：暖光看板 Minimalist Kanban`;
    const detailsParam = encodeURIComponent(details);

    let datesParam = '';
    if (todo.dueDate) {
      const startDate = new Date(todo.dueDate);
      if (!isNaN(startDate.getTime())) {
        const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // 預設 1 小時行程
        datesParam = `&dates=${formatGCalDate(startDate)}/${formatGCalDate(endDate)}`;
      }
    } else {
      // 若未指定明確時間，預設設定為今日下個整點，持續 1 小時
      const now = new Date();
      now.setMinutes(0, 0, 0);
      now.setHours(now.getHours() + 1);
      const endDate = new Date(now.getTime() + 60 * 60 * 1000);
      datesParam = `&dates=${formatGCalDate(now)}/${formatGCalDate(endDate)}`;
    }

    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&details=${detailsParam}${datesParam}`;
  }

  // ==========================================================================
  // 事件綁定
  // ==========================================================================

  function bindFormAndFilterEvents() {
    // 新增任務
    todoForm.addEventListener('submit', function (e) {
      e.preventDefault();
      const text = todoInput.value.trim();
      const assignee = assigneeInput.value.trim();
      const dueDate = dueDateInput.value;
      const categoryRadio = document.querySelector('input[name="taskCategory"]:checked');
      const category = categoryRadio ? categoryRadio.value : 'work';

      if (!text) return;

      addTodo(text, assignee, category, dueDate);

      // 清空輸入並重設焦點
      todoInput.value = '';
      assigneeInput.value = '';
      dueDateInput.value = '';
      todoInput.focus();
    });

    // 分類切換
    filterTabs.forEach(tab => {
      tab.addEventListener('click', function () {
        const filter = this.getAttribute('data-filter');
        setCategoryFilter(filter);
      });
    });

    // 清除 Done
    if (clearDoneBtn) {
      clearDoneBtn.addEventListener('click', function () {
        clearDoneTasks();
      });
    }

    // 看板卡片操作委派 (刪除、Google 日曆同步、箭頭快捷切換)
    document.querySelector('.kanban-board').addEventListener('click', function (e) {
      // 1. 加入 Google 日曆
      const gcalBtn = e.target.closest('.btn-gcal-action');
      if (gcalBtn) {
        const id = gcalBtn.getAttribute('data-id');
        const todo = todos.find(t => t.id === id);
        if (todo) {
          const url = createGoogleCalendarUrl(todo);
          window.open(url, '_blank', 'noopener,noreferrer');
        }
        return;
      }

      // 2. 刪除卡片
      const deleteBtn = e.target.closest('.btn-delete-card');
      if (deleteBtn) {
        const id = deleteBtn.getAttribute('data-id');
        deleteTodo(id);
        return;
      }

      // 3. 箭頭快捷切換欄位
      const moveBtn = e.target.closest('.btn-move-step');
      if (moveBtn) {
        const id = moveBtn.getAttribute('data-id');
        const nextStatus = moveBtn.getAttribute('data-next');
        if (id && nextStatus) {
          moveTodoToStatus(id, nextStatus);
        }
      }
    });
  }

  // 新增待辦
  function addTodo(text, assignee, category, dueDate) {
    const newTodo = {
      id: 'card_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      text: text,
      assignee: assignee,
      category: category,
      status: 'todo',
      dueDate: dueDate || '',
      createdAt: Date.now()
    };

    todos.unshift(newTodo);
    saveTodos();
    render();
  }

  // 移動任務到指定欄位狀態
  function moveTodoToStatus(id, targetStatus) {
    const validStatuses = ['todo', 'process', 'done'];
    if (!validStatuses.includes(targetStatus)) return;

    let modified = false;
    todos = todos.map(item => {
      if (item.id === id && item.status !== targetStatus) {
        modified = true;
        return { ...item, status: targetStatus };
      }
      return item;
    });

    if (modified) {
      saveTodos();
      render();
    }
  }

  // 刪除任務
  function deleteTodo(id) {
    todos = todos.filter(item => item.id !== id);
    saveTodos();
    render();
  }

  // 清空 Done 欄位
  function clearDoneTasks() {
    todos = todos.filter(item => item.status !== 'done');
    saveTodos();
    render();
  }

  // 切換分類
  function setCategoryFilter(filter) {
    currentCategoryFilter = filter;
    filterTabs.forEach(tab => {
      if (tab.getAttribute('data-filter') === filter) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });
    render();
  }

  // ==========================================================================
  // HTML5 Drag and Drop 拖曳機制
  // ==========================================================================

  function bindDropzoneEvents() {
    dropzones.forEach(dropzone => {
      dropzone.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        this.classList.add('drag-over');
      });

      dropzone.addEventListener('dragleave', function (e) {
        if (!this.contains(e.relatedTarget)) {
          this.classList.remove('drag-over');
        }
      });

      dropzone.addEventListener('drop', function (e) {
        e.preventDefault();
        this.classList.remove('drag-over');
        
        const targetStatus = this.getAttribute('data-status');
        const cardId = e.dataTransfer.getData('text/plain') || draggedTodoId;

        if (cardId && targetStatus) {
          moveTodoToStatus(cardId, targetStatus);
        }
      });
    });
  }

  function attachCardDragEvents(cardEl) {
    cardEl.addEventListener('dragstart', function (e) {
      draggedTodoId = this.getAttribute('data-id');
      e.dataTransfer.setData('text/plain', draggedTodoId);
      e.dataTransfer.effectAllowed = 'move';
      this.classList.add('dragging');
    });

    cardEl.addEventListener('dragend', function () {
      draggedTodoId = null;
      this.classList.remove('dragging');
      dropzones.forEach(dz => dz.classList.remove('drag-over'));
    });
  }

  // ==========================================================================
  // 畫面渲染 (Render)
  // ==========================================================================

  function render() {
    // 統計計算
    const totalAll = todos.length;
    const totalWork = todos.filter(t => t.category === 'work').length;
    const totalLife = todos.filter(t => t.category === 'life').length;

    if (countAllEl) countAllEl.textContent = totalAll;
    if (countWorkEl) countWorkEl.textContent = totalWork;
    if (countLifeEl) countLifeEl.textContent = totalLife;

    // 分類篩選
    const visibleTodos = todos.filter(item => {
      if (currentCategoryFilter === 'work') return item.category === 'work';
      if (currentCategoryFilter === 'life') return item.category === 'life';
      return true;
    });

    const todoCards = visibleTodos.filter(item => item.status === 'todo');
    const processCards = visibleTodos.filter(item => item.status === 'process');
    const doneCards = visibleTodos.filter(item => item.status === 'done');

    // 欄位標頭數量徽章
    if (badgeCountTodo) badgeCountTodo.textContent = todoCards.length;
    if (badgeCountProcess) badgeCountProcess.textContent = processCards.length;
    if (badgeCountDone) badgeCountDone.textContent = doneCards.length;

    if (clearDoneBtn) {
      clearDoneBtn.disabled = doneCards.length === 0;
    }

    // 渲染三個欄位
    renderColumn(listTodo, todoCards, 'todo');
    renderColumn(listProcess, processCards, 'process');
    renderColumn(listDone, doneCards, 'done');
  }

  function renderColumn(containerEl, cards, status) {
    if (!containerEl) return;

    const dropzone = containerEl.closest('.kanban-dropzone');
    if (dropzone) {
      if (cards.length === 0) {
        dropzone.classList.add('is-empty');
      } else {
        dropzone.classList.remove('is-empty');
      }
    }

    containerEl.innerHTML = cards.map(todo => createCardHtml(todo, status)).join('');

    containerEl.querySelectorAll('.task-card').forEach(cardEl => {
      attachCardDragEvents(cardEl);
    });
  }

  function createCardHtml(todo, currentStatus) {
    const isWork = todo.category === 'work';
    const categoryLabel = isWork ? '💼 工作' : '🌿 生活';
    const categoryBadgeClass = isWork ? 'badge-work' : 'badge-life';

    // 負責人標籤
    const assigneeHtml = todo.assignee
      ? `<span class="badge badge-assignee" title="負責人: ${escapeHtml(todo.assignee)}">
           <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
             <circle cx="12" cy="7" r="4"></circle>
           </svg>
           ${escapeHtml(todo.assignee)}
         </span>`
      : '';

    // 到期日標籤
    const friendlyDate = formatFriendlyDueDate(todo.dueDate);
    const dueDateHtml = friendlyDate
      ? `<span class="badge badge-date" title="預計完成時間: ${todo.dueDate}">
           <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <circle cx="12" cy="12" r="10"></circle>
             <polyline points="12 6 12 12 16 14"></polyline>
           </svg>
           ${friendlyDate}
         </span>`
      : '';

    // 欄位切換快捷箭頭
    let moveControls = '';
    if (currentStatus === 'todo') {
      moveControls = `
        <button type="button" class="btn-card-action btn-move-step" data-id="${todo.id}" data-next="process" title="移動到 Process (進行中)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </button>
      `;
    } else if (currentStatus === 'process') {
      moveControls = `
        <button type="button" class="btn-card-action btn-move-step" data-id="${todo.id}" data-next="todo" title="移回 To-do (待辦)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
        <button type="button" class="btn-card-action btn-move-step" data-id="${todo.id}" data-next="done" title="完成並移動到 Done">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </button>
      `;
    } else if (currentStatus === 'done') {
      moveControls = `
        <button type="button" class="btn-card-action btn-move-step" data-id="${todo.id}" data-next="process" title="移回 Process (進行中)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
      `;
    }

    return `
      <li class="task-card" draggable="true" data-id="${todo.id}">
        <div class="card-header">
          <span class="drag-handle" title="按住拖曳跨欄">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="8" cy="6" r="1.5"></circle>
              <circle cx="16" cy="6" r="1.5"></circle>
              <circle cx="8" cy="12" r="1.5"></circle>
              <circle cx="16" cy="12" r="1.5"></circle>
              <circle cx="8" cy="18" r="1.5"></circle>
              <circle cx="16" cy="18" r="1.5"></circle>
            </svg>
          </span>
          <p class="card-title">${escapeHtml(todo.text)}</p>
        </div>

        <div class="card-footer">
          <div class="card-badges">
            ${dueDateHtml}
            ${assigneeHtml}
            <span class="badge ${categoryBadgeClass}">${categoryLabel}</span>
          </div>

          <div class="card-actions">
            <!-- Google 日曆一鍵排程按鈕 -->
            <button type="button" class="btn-card-action btn-gcal-action" data-id="${todo.id}" title="加入 Google 日曆 (另開新行程)" aria-label="加入 Google 日曆">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
              </svg>
            </button>
            ${moveControls}
            <button type="button" class="btn-card-action btn-delete-card" data-id="${todo.id}" title="刪除此任務" aria-label="刪除此任務">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </div>
      </li>
    `;
  }

  // 頁面就緒啟動
  document.addEventListener('DOMContentLoaded', init);
})();
