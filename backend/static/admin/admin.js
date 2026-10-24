const state = {
  config: {
    requiresToken: false,
    passwordLoginEnabled: false,
    defaultUsername: "admin",
    displayName: "平台管理员",
    sessionExpireHours: 72,
  },
  session: {
    token: "",
    displayName: "未登录",
  },
  reviewSelection: new Set(),
  users: { page: 1, pageSize: 12, total: 0 },
  services: { page: 1, pageSize: 12, total: 0 },
  experiences: { page: 1, pageSize: 12, total: 0 },
  feedbacks: { page: 1, pageSize: 12, total: 0 },
  logs: { page: 1, pageSize: 12, total: 0 },
  detail: {
    bizType: "",
    itemId: "",
  },
};

const elements = {
  adminModePill: document.getElementById("adminModePill"),
  currentAdminLabel: document.getElementById("currentAdminLabel"),
  overviewMetrics: document.getElementById("overviewMetrics"),
  registrationChart: document.getElementById("registrationChart"),
  trendSummary: document.getElementById("trendSummary"),
  providerDistribution: document.getElementById("providerDistribution"),
  reviewQueueTable: document.getElementById("reviewQueueTable"),
  reviewSelectAll: document.getElementById("reviewSelectAll"),
  usersTable: document.getElementById("usersTable"),
  usersPaginationText: document.getElementById("usersPaginationText"),
  servicesTable: document.getElementById("servicesTable"),
  servicesPaginationText: document.getElementById("servicesPaginationText"),
  experiencesTable: document.getElementById("experiencesTable"),
  experiencesPaginationText: document.getElementById("experiencesPaginationText"),
  feedbackTable: document.getElementById("feedbackTable"),
  feedbackPaginationText: document.getElementById("feedbackPaginationText"),
  logsTable: document.getElementById("logsTable"),
  logsPaginationText: document.getElementById("logsPaginationText"),
  userSearchInput: document.getElementById("userSearchInput"),
  userProviderSelect: document.getElementById("userProviderSelect"),
  userVerificationSelect: document.getElementById("userVerificationSelect"),
  serviceSearchInput: document.getElementById("serviceSearchInput"),
  serviceStatusSelect: document.getElementById("serviceStatusSelect"),
  experienceSearchInput: document.getElementById("experienceSearchInput"),
  experienceStatusSelect: document.getElementById("experienceStatusSelect"),
  feedbackSearchInput: document.getElementById("feedbackSearchInput"),
  feedbackStatusSelect: document.getElementById("feedbackStatusSelect"),
  feedbackCategorySelect: document.getElementById("feedbackCategorySelect"),
  loginModal: document.getElementById("loginModal"),
  loginForm: document.getElementById("loginForm"),
  loginUsernameInput: document.getElementById("loginUsernameInput"),
  loginPasswordInput: document.getElementById("loginPasswordInput"),
  loginTokenInput: document.getElementById("loginTokenInput"),
  tokenLoginField: document.getElementById("tokenLoginField"),
  detailDrawer: document.getElementById("detailDrawer"),
  detailPanelTitle: document.getElementById("detailPanelTitle"),
  detailPanelSubtitle: document.getElementById("detailPanelSubtitle"),
  detailCoverImage: document.getElementById("detailCoverImage"),
  detailImageGallery: document.getElementById("detailImageGallery"),
  detailForm: document.getElementById("detailForm"),
  detailBizType: document.getElementById("detailBizType"),
  detailItemId: document.getElementById("detailItemId"),
  detailTitleInput: document.getElementById("detailTitleInput"),
  detailCategoryInput: document.getElementById("detailCategoryInput"),
  detailLocationInput: document.getElementById("detailLocationInput"),
  detailPriceInput: document.getElementById("detailPriceInput"),
  detailCoverInput: document.getElementById("detailCoverInput"),
  detailImageUrlsInput: document.getElementById("detailImageUrlsInput"),
  detailDescriptionInput: document.getElementById("detailDescriptionInput"),
  serviceExtraFields: document.getElementById("serviceExtraFields"),
  detailPriorityInput: document.getElementById("detailPriorityInput"),
  detailImportantCheckbox: document.getElementById("detailImportantCheckbox"),
  detailSquareCheckbox: document.getElementById("detailSquareCheckbox"),
  toast: document.getElementById("toast"),
};

function getStoredToken() {
  return window.localStorage.getItem("aiye_admin_token") || "";
}

function setStoredToken(token) {
  window.localStorage.setItem("aiye_admin_token", token.trim());
  state.session.token = token.trim();
}

function clearStoredSession() {
  window.localStorage.removeItem("aiye_admin_token");
  state.session.token = "";
  state.session.displayName = "未登录";
  updateSessionUI();
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 2400);
}

function openLoginModal() {
  elements.loginUsernameInput.value = state.config.defaultUsername || "admin";
  elements.loginPasswordInput.value = "";
  elements.loginTokenInput.value = "";
  elements.tokenLoginField.classList.toggle("hidden", !state.config.requiresToken);
  elements.loginModal.classList.remove("hidden");
}

function closeLoginModal() {
  elements.loginModal.classList.add("hidden");
}

function updateSessionUI() {
  elements.currentAdminLabel.textContent = state.session.displayName || "未登录";
  if (state.session.token) {
    elements.adminModePill.textContent = state.config.passwordLoginEnabled ? "已登录后台" : "口令访问";
  } else if (state.config.requiresToken || state.config.passwordLoginEnabled) {
    elements.adminModePill.textContent = "待登录";
  } else {
    elements.adminModePill.textContent = "本地直连";
  }
}

async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = state.session.token || getStoredToken();
  if (!options.skipAuth && token) {
    headers.set("X-Admin-Token", token);
  }
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, {
    ...options,
    headers,
  });
  if (!response.ok) {
    let detail = "请求失败";
    try {
      const payload = await response.json();
      detail = payload.detail || detail;
    } catch (error) {
      detail = response.statusText || detail;
    }
    const error = new Error(detail);
    error.status = response.status;
    if (!options.skipAuth && (response.status === 401 || response.status === 403)) {
      clearStoredSession();
      openLoginModal();
    }
    throw error;
  }
  return response.json();
}

function providerLabel(provider) {
  if (provider === "wechat") {
    return "微信";
  }
  if (provider === "password") {
    return "密码";
  }
  return provider || "-";
}

function feedbackCategoryLabel(category) {
  return {
    bug: "Bug",
    feature: "功能建议",
    service: "服务问题",
    general: "其他",
  }[category] || category || "-";
}

function feedbackStatusLabel(status) {
  return {
    pending: "待处理",
    processing: "处理中",
    closed: "已关闭",
  }[status] || status || "-";
}

function statusTone(status) {
  if (["approved", "success", "closed"].includes(status)) {
    return "success";
  }
  if (["pending_review", "draft", "processing", "warning"].includes(status)) {
    return "warning";
  }
  if (["rejected", "deleted", "danger"].includes(status)) {
    return "danger";
  }
  return "";
}

function statusTag(text, tone = "") {
  return `<span class="status-tag ${tone}">${text}</span>`;
}

function boolText(value, onText, offText) {
  return value ? onText : offText;
}

function buildPaginationText(result) {
  if (!result.total) {
    return "共 0 条";
  }
  const start = (result.page - 1) * result.page_size + 1;
  const end = Math.min(result.page * result.page_size, result.total);
  return `第 ${result.page} 页，显示 ${start}-${end} / 共 ${result.total} 条`;
}

function renderOverviewMetrics(metrics) {
  const items = [
    {
      label: "总用户",
      value: metrics.total_users,
      footnote: `今日新增 ${metrics.new_users_today} / 近7天 ${metrics.new_users_last_7_days}`,
    },
    {
      label: "待审核服务",
      value: metrics.pending_service_reviews,
      footnote: `已通过 ${metrics.approved_services} / 驳回 ${metrics.rejected_services}`,
    },
    {
      label: "待审核体验",
      value: metrics.pending_experience_reviews,
      footnote: `已通过 ${metrics.approved_experiences} / 驳回 ${metrics.rejected_experiences}`,
    },
    {
      label: "待处理反馈",
      value: metrics.pending_feedbacks,
      footnote: `处理中 ${metrics.processing_feedbacks} 条`,
    },
    {
      label: "手机号验证",
      value: `${metrics.phone_verified_rate}%`,
      footnote: `${metrics.phone_verified_users} 位用户已完成绑定`,
    },
    {
      label: "资料完成率",
      value: `${metrics.profile_completed_rate}%`,
      footnote: `${metrics.profile_completed_users} 位用户已完善资料`,
    },
    {
      label: "服务库存",
      value: metrics.total_services,
      footnote: `发布 ${metrics.active_services} / 草稿 ${metrics.draft_services} / 提权 ${metrics.prioritized_services}`,
    },
    {
      label: "体验库存",
      value: metrics.total_experiences,
      footnote: `正常 ${metrics.active_experiences} / 删除 ${metrics.deleted_experiences}`,
    },
  ];
  elements.overviewMetrics.innerHTML = items.map((item) => `
      <div class="metric-card">
        <div class="metric-label">${item.label}</div>
        <div class="metric-value">${item.value}</div>
        <div class="metric-footnote">${item.footnote}</div>
      </div>
    `).join("");
}

function renderRegistrationChart(series) {
  const maxCount = Math.max(...series.map((item) => item.count), 1);
  const total = series.reduce((sum, item) => sum + item.count, 0);
  elements.trendSummary.textContent = `近 14 天累计 ${total} 人注册`;
  elements.registrationChart.innerHTML = series.map((item) => {
    const height = Math.max(10, Math.round((item.count / maxCount) * 150));
    return `
      <div class="chart-bar">
        <div class="chart-bar-value">${item.count}</div>
        <div class="chart-bar-visual" style="height:${height}px"></div>
        <div class="chart-bar-label">${item.label}</div>
      </div>
    `;
  }).join("");
}

function renderProviderDistribution(items) {
  const maxCount = Math.max(...items.map((item) => item.count), 1);
  if (!items.length) {
    elements.providerDistribution.innerHTML = '<div class="empty-state">暂无来源数据</div>';
    return;
  }
  elements.providerDistribution.innerHTML = items.map((item) => `
      <div class="provider-item">
        <div class="provider-row">
          <div>
            <div class="provider-name">${providerLabel(item.provider)}</div>
            <div class="table-subtitle">${item.provider}</div>
          </div>
          <div class="provider-count">${item.count}</div>
        </div>
        <div class="provider-track">
          <div class="provider-progress" style="width:${Math.max(8, (item.count / maxCount) * 100)}%"></div>
        </div>
      </div>
    `).join("");
}

function reviewKey(bizType, itemId) {
  return `${bizType}:${itemId}`;
}

function syncReviewSelectAll(items) {
  if (!items.length) {
    elements.reviewSelectAll.checked = false;
    return;
  }
  const allChecked = items.every((item) => state.reviewSelection.has(reviewKey(item.biz_type, item.id)));
  elements.reviewSelectAll.checked = allChecked;
}

function renderReviewQueue(items) {
  if (!items.length) {
    state.reviewSelection.clear();
    syncReviewSelectAll([]);
    elements.reviewQueueTable.innerHTML =
      '<tr><td colspan="7"><div class="empty-state">当前没有待审核内容</div></td></tr>';
    return;
  }
  syncReviewSelectAll(items);
  elements.reviewQueueTable.innerHTML = items.map((item) => {
    const key = reviewKey(item.biz_type, item.id);
    return `
      <tr>
        <td><input type="checkbox" data-review-checkbox="true" data-review-biz="${item.biz_type}" data-review-id="${item.id}" ${state.reviewSelection.has(key) ? "checked" : ""} /></td>
        <td>${statusTag(item.biz_type === "service" ? "服务" : "体验")}</td>
        <td>
          <div class="table-title">${item.title || "未命名内容"}</div>
          <div class="table-subtitle">${item.category || "-"} · ${item.id}</div>
          <div class="table-subtitle">${item.location || "未填写地点"} · ${item.price_text || "未填写价格"}</div>
        </td>
        <td>
          <div class="table-title">${item.owner_name || "未知发布者"}</div>
          <div class="table-subtitle">${item.biz_type === "service" ? item.creator_phone_number || item.creator_id : item.host_phone_number || item.host_id}</div>
        </td>
        <td>
          <div class="table-title">${item.review_submitted_at_label || "-"}</div>
          <div class="table-subtitle">${item.updated_at_label || "-"}</div>
        </td>
        <td><div class="note-text">${item.review_note || "暂无备注"}</div></td>
        <td>
          <div class="action-group">
            <button class="mini-button" data-review-biz="${item.biz_type}" data-review-id="${item.id}" data-review-action="approve">通过</button>
            <button class="mini-button" data-review-biz="${item.biz_type}" data-review-id="${item.id}" data-review-action="reject">驳回</button>
            <button class="mini-button" data-review-biz="${item.biz_type}" data-review-id="${item.id}" data-review-action="detail">查看详情</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function renderUsers(result) {
  elements.usersPaginationText.textContent = buildPaginationText(result);
  if (!result.items.length) {
    elements.usersTable.innerHTML = '<tr><td colspan="6"><div class="empty-state">没有匹配到用户</div></td></tr>';
    return;
  }
  elements.usersTable.innerHTML = result.items.map((item) => `
      <tr>
        <td>
          <div class="table-title">${item.name || "未命名用户"}</div>
          <div class="table-subtitle">${item.pei_pei_id || item.id}</div>
          <div class="table-subtitle">${item.phone_number || "未绑定手机号"}</div>
        </td>
        <td>${statusTag(providerLabel(item.login_provider))}</td>
        <td>
          <div class="status-group">
            ${item.is_phone_verified ? statusTag("已绑手机", "success") : statusTag("未绑手机", "warning")}
            ${item.is_profile_completed ? statusTag("资料完整", "success") : statusTag("资料待完善")}
            ${item.identity_verified ? statusTag("已实名", "success") : statusTag("未实名")}
          </div>
        </td>
        <td>
          <div class="table-title">服务 ${item.service_count}</div>
          <div class="table-subtitle">体验 ${item.experience_count} · 年限 ${item.service_years}</div>
        </td>
        <td>
          <div class="table-title">${item.last_login_at_label}</div>
          <div class="table-subtitle">注册于 ${item.created_at_label}</div>
        </td>
        <td>
          <div class="action-group">
            <button class="mini-button" data-user-id="${item.id}" data-user-field="is_phone_verified" data-user-next="${(!item.is_phone_verified).toString()}">${boolText(item.is_phone_verified, "取消手机验证", "标记手机验证")}</button>
            <button class="mini-button" data-user-id="${item.id}" data-user-field="is_profile_completed" data-user-next="${(!item.is_profile_completed).toString()}">${boolText(item.is_profile_completed, "取消资料完成", "标记资料完成")}</button>
            <button class="mini-button" data-user-id="${item.id}" data-user-field="identity_verified" data-user-next="${(!item.identity_verified).toString()}">${boolText(item.identity_verified, "取消实名", "标记实名")}</button>
          </div>
        </td>
      </tr>
    `).join("");
}

function renderServices(result) {
  elements.servicesPaginationText.textContent = buildPaginationText(result);
  if (!result.items.length) {
    elements.servicesTable.innerHTML = '<tr><td colspan="6"><div class="empty-state">没有匹配到服务</div></td></tr>';
    return;
  }
  elements.servicesTable.innerHTML = result.items.map((item) => `
      <tr>
        <td>
          <div class="table-title">${item.title || "未命名服务"}</div>
          <div class="table-subtitle">${item.category || "-"} · ${item.id}</div>
        </td>
        <td>
          <div class="table-title">${item.creator_name || "未知发布者"}</div>
          <div class="table-subtitle">${item.creator_phone_number || item.creator_id}</div>
        </td>
        <td>
          <div class="status-group">
            ${statusTag(item.review_status_label, statusTone(item.review_status))}
            ${item.is_deleted ? statusTag("已删除", "danger") : statusTag("正常", "success")}
            ${item.is_draft ? statusTag("草稿", "warning") : statusTag("非草稿")}
            ${item.sync_to_square ? statusTag("广场展示", "success") : statusTag("未上广场")}
            ${item.is_important ? statusTag("重点", "success") : ""}
            ${item.sort_priority > 0 ? statusTag(`优先级 ${item.sort_priority}`, "success") : statusTag("默认排序")}
          </div>
          <div class="table-subtitle">提交 ${item.review_submitted_at_label || "-"} / 审核 ${item.reviewed_at_label || "-"}</div>
          <div class="note-text">${item.review_note || "暂无审核备注"}</div>
        </td>
        <td>
          <div class="table-title">${item.price_text || "未填写价格"}</div>
          <div class="table-subtitle">${item.location || "未填写地点"}</div>
        </td>
        <td>
          <div class="table-title">${item.updated_at_label}</div>
          <div class="table-subtitle">创建于 ${item.created_at_label}</div>
        </td>
        <td>
          <div class="action-group">
            <button class="mini-button" data-service-id="${item.id}" data-service-action="detail">详情</button>
            <button class="mini-button" data-service-id="${item.id}" data-service-action="review-approve">通过</button>
            <button class="mini-button" data-service-id="${item.id}" data-service-action="review-reject">驳回</button>
            <button class="mini-button" data-service-id="${item.id}" data-service-action="toggle-delete" data-service-next="${(!item.is_deleted).toString()}">${boolText(item.is_deleted, "恢复", "删除")}</button>
            <button class="mini-button" data-service-id="${item.id}" data-service-action="toggle-draft" data-service-next="${(!item.is_draft).toString()}">${boolText(item.is_draft, "发布", "转草稿")}</button>
            <button class="mini-button" data-service-id="${item.id}" data-service-action="toggle-square" data-service-next="${(!item.sync_to_square).toString()}">${boolText(item.sync_to_square, "移出广场", "同步广场")}</button>
            <button class="mini-button" data-service-id="${item.id}" data-service-action="toggle-important" data-service-next="${(!item.is_important).toString()}">${boolText(item.is_important, "取消重点", "设为重点")}</button>
            <button class="mini-button" data-service-id="${item.id}" data-service-action="set-priority" data-service-priority="${item.sort_priority}">设置优先级</button>
          </div>
        </td>
      </tr>
    `).join("");
}

function renderExperiences(result) {
  elements.experiencesPaginationText.textContent = buildPaginationText(result);
  if (!result.items.length) {
    elements.experiencesTable.innerHTML = '<tr><td colspan="6"><div class="empty-state">没有匹配到体验</div></td></tr>';
    return;
  }
  elements.experiencesTable.innerHTML = result.items.map((item) => `
      <tr>
        <td>
          <div class="table-title">${item.title || "未命名体验"}</div>
          <div class="table-subtitle">${item.category || "-"} · ${item.id}</div>
        </td>
        <td>
          <div class="table-title">${item.host_name || "未知主理人"}</div>
          <div class="table-subtitle">${item.host_phone_number || item.host_id}</div>
        </td>
        <td>
          <div class="status-group">
            ${statusTag(item.review_status_label, statusTone(item.review_status))}
            ${statusTag(`评分 ${Number(item.average_rating || 0).toFixed(2)}`)}
            ${item.is_deleted ? statusTag("已删除", "danger") : statusTag("正常", "success")}
          </div>
          <div class="table-subtitle">提交 ${item.review_submitted_at_label || "-"} / 审核 ${item.reviewed_at_label || "-"}</div>
          <div class="note-text">${item.review_note || "暂无审核备注"}</div>
        </td>
        <td>
          <div class="table-title">${item.price_text || "未填写价格"}</div>
          <div class="table-subtitle">${item.location || "未填写地点"}</div>
        </td>
        <td>
          <div class="table-title">${item.updated_at_label}</div>
          <div class="table-subtitle">创建于 ${item.created_at_label}</div>
        </td>
        <td>
          <div class="action-group">
            <button class="mini-button" data-experience-id="${item.id}" data-experience-action="detail">详情</button>
            <button class="mini-button" data-experience-id="${item.id}" data-experience-action="review-approve">通过</button>
            <button class="mini-button" data-experience-id="${item.id}" data-experience-action="review-reject">驳回</button>
            <button class="mini-button" data-experience-id="${item.id}" data-experience-action="toggle-delete" data-experience-next="${(!item.is_deleted).toString()}">${boolText(item.is_deleted, "恢复", "删除")}</button>
          </div>
        </td>
      </tr>
    `).join("");
}

function renderFeedbacks(result) {
  elements.feedbackPaginationText.textContent = buildPaginationText(result);
  if (!result.items.length) {
    elements.feedbackTable.innerHTML = '<tr><td colspan="6"><div class="empty-state">暂无反馈记录</div></td></tr>';
    return;
  }
  elements.feedbackTable.innerHTML = result.items.map((item) => `
      <tr>
        <td>
          <div class="table-title">${item.user_name || "匿名用户"}</div>
          <div class="table-subtitle">${item.phone_number || item.user_id || "未留手机号"}</div>
          <div class="table-subtitle">${item.contact || "未留额外联系方式"}</div>
        </td>
        <td>
          <div class="status-group">
            ${statusTag(feedbackCategoryLabel(item.category))}
            ${statusTag(item.source || "app")}
          </div>
          <div class="table-subtitle mono-text">${item.id}</div>
        </td>
        <td><div class="content-cell">${item.content || "-"}</div></td>
        <td>
          <div class="status-group">${statusTag(feedbackStatusLabel(item.status), statusTone(item.status))}</div>
          <div class="table-subtitle">提交 ${item.created_at_label}</div>
          <div class="table-subtitle">处理 ${item.handled_at_label || "-"}</div>
        </td>
        <td><div class="note-text">${item.admin_note || "暂无跟进备注"}</div></td>
        <td>
          <div class="action-group">
            <button class="mini-button" data-feedback-id="${item.id}" data-feedback-status="pending">待处理</button>
            <button class="mini-button" data-feedback-id="${item.id}" data-feedback-status="processing">处理中</button>
            <button class="mini-button" data-feedback-id="${item.id}" data-feedback-status="closed">关闭</button>
            <button class="mini-button" data-feedback-id="${item.id}" data-feedback-action="note">备注</button>
          </div>
        </td>
      </tr>
    `).join("");
}

function renderLogs(result) {
  elements.logsPaginationText.textContent = buildPaginationText(result);
  if (!result.items.length) {
    elements.logsTable.innerHTML = '<tr><td colspan="6"><div class="empty-state">暂无操作日志</div></td></tr>';
    return;
  }
  elements.logsTable.innerHTML = result.items.map((item) => `
      <tr>
        <td>${item.created_at_label}</td>
        <td>${item.actor || "-"}</td>
        <td>${statusTag(item.action || "-")}</td>
        <td>
          <div class="table-title">${item.entity_type || "-"}</div>
          <div class="table-subtitle mono-text">${item.entity_id || "-"}</div>
        </td>
        <td><div class="content-cell">${item.summary || "-"}</div></td>
        <td><div class="note-text">${item.detail || "-"}</div></td>
      </tr>
    `).join("");
}

function renderDetailImages(coverUrl, imageUrls) {
  const fallback = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='400'%3E%3Crect width='100%25' height='100%25' fill='%23eef3fb'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%2394a3b8' font-size='28'%3E暂无图片%3C/text%3E%3C/svg%3E";
  elements.detailCoverImage.src = coverUrl || imageUrls[0] || fallback;
  elements.detailImageGallery.innerHTML = (imageUrls || []).slice(0, 9).map((url) => `<img src="${url}" alt="图片预览" />`).join("");
}

function fillDetailForm(bizType, item) {
  state.detail.bizType = bizType;
  state.detail.itemId = item.id;
  elements.detailBizType.value = bizType;
  elements.detailItemId.value = item.id;
  elements.detailPanelTitle.textContent = bizType === "service" ? "服务详情编辑" : "体验详情编辑";
  elements.detailPanelSubtitle.textContent = `${item.title || "未命名内容"} · ${item.id}`;
  elements.detailTitleInput.value = item.title || "";
  elements.detailCategoryInput.value = item.category || "";
  elements.detailLocationInput.value = item.location || "";
  elements.detailPriceInput.value = item.price_text || "";
  elements.detailCoverInput.value = item.cover_image_url || "";
  elements.detailImageUrlsInput.value = (item.image_urls || []).join("\n");
  elements.detailDescriptionInput.value = item.description || "";
  const isService = bizType === "service";
  elements.serviceExtraFields.classList.toggle("hidden", !isService);
  elements.detailPriorityInput.value = isService ? String(item.sort_priority || 0) : "0";
  elements.detailImportantCheckbox.checked = isService ? Boolean(item.is_important) : false;
  elements.detailSquareCheckbox.checked = isService ? Boolean(item.sync_to_square) : false;
  renderDetailImages(item.cover_image_url || "", item.image_urls || []);
}

function openDetailDrawer() {
  elements.detailDrawer.classList.remove("hidden");
}

function closeDetailDrawer() {
  elements.detailDrawer.classList.add("hidden");
}

async function loadOverview() {
  const data = await apiFetch("/admin/api/overview");
  renderOverviewMetrics(data.metrics);
  renderRegistrationChart(data.registration_series);
  renderProviderDistribution(data.provider_distribution);
}

async function loadReviewQueue() {
  const data = await apiFetch("/admin/api/review-queue?limit=50");
  renderReviewQueue(data.items || []);
}

async function loadUsers() {
  const params = new URLSearchParams({
    q: elements.userSearchInput.value.trim(),
    provider: elements.userProviderSelect.value,
    verification: elements.userVerificationSelect.value,
    page: String(state.users.page),
    page_size: String(state.users.pageSize),
  });
  const data = await apiFetch(`/admin/api/users?${params.toString()}`);
  state.users.total = data.total;
  renderUsers(data);
}

async function loadServices() {
  const params = new URLSearchParams({
    q: elements.serviceSearchInput.value.trim(),
    status: elements.serviceStatusSelect.value,
    page: String(state.services.page),
    page_size: String(state.services.pageSize),
  });
  const data = await apiFetch(`/admin/api/services?${params.toString()}`);
  state.services.total = data.total;
  renderServices(data);
}

async function loadExperiences() {
  const params = new URLSearchParams({
    q: elements.experienceSearchInput.value.trim(),
    status: elements.experienceStatusSelect.value,
    page: String(state.experiences.page),
    page_size: String(state.experiences.pageSize),
  });
  const data = await apiFetch(`/admin/api/experiences?${params.toString()}`);
  state.experiences.total = data.total;
  renderExperiences(data);
}

async function loadFeedbacks() {
  const params = new URLSearchParams({
    q: elements.feedbackSearchInput.value.trim(),
    status: elements.feedbackStatusSelect.value,
    category: elements.feedbackCategorySelect.value,
    page: String(state.feedbacks.page),
    page_size: String(state.feedbacks.pageSize),
  });
  const data = await apiFetch(`/admin/api/feedbacks?${params.toString()}`);
  state.feedbacks.total = data.total;
  renderFeedbacks(data);
}

async function loadLogs() {
  const params = new URLSearchParams({
    page: String(state.logs.page),
    page_size: String(state.logs.pageSize),
  });
  const data = await apiFetch(`/admin/api/operation-logs?${params.toString()}`);
  state.logs.total = data.total;
  renderLogs(data);
}

async function refreshAllData() {
  await Promise.all([
    loadOverview(),
    loadReviewQueue(),
    loadUsers(),
    loadServices(),
    loadExperiences(),
    loadFeedbacks(),
    loadLogs(),
  ]);
}

async function updateUser(userId, patch) {
  await apiFetch(`/admin/api/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  showToast("用户状态已更新");
  await Promise.all([loadUsers(), loadLogs()]);
}

async function updateService(serviceId, patch) {
  await apiFetch(`/admin/api/services/${serviceId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  showToast("服务状态已更新");
  await Promise.all([loadOverview(), loadReviewQueue(), loadServices(), loadLogs()]);
}

async function updateExperience(experienceId, patch) {
  await apiFetch(`/admin/api/experiences/${experienceId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  showToast("体验状态已更新");
  await Promise.all([loadOverview(), loadReviewQueue(), loadExperiences(), loadLogs()]);
}

async function updateFeedback(feedbackId, patch) {
  await apiFetch(`/admin/api/feedbacks/${feedbackId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  showToast("反馈状态已更新");
  await Promise.all([loadOverview(), loadFeedbacks(), loadLogs()]);
}

function canGoPrev(page) {
  return page > 1;
}

function canGoNext(page, pageSize, total) {
  return page * pageSize < total;
}

function askForNote(defaultValue, title) {
  return window.prompt(title, defaultValue || "");
}

function getSelectedReviewItems() {
  return Array.from(state.reviewSelection).map((value) => {
    const [biz_type, item_id] = value.split(":");
    return { biz_type, item_id };
  });
}

async function runBatchReview(reviewStatus) {
  const items = getSelectedReviewItems();
  if (!items.length) {
    showToast("请先勾选待审核内容");
    return;
  }
  const defaultNote = reviewStatus === "approved" ? "批量审核通过" : "";
  const note = askForNote(defaultNote, reviewStatus === "approved" ? "填写批量通过备注" : "填写批量驳回原因");
  if (note === null) {
    return;
  }
  if (reviewStatus === "rejected" && !note.trim()) {
    showToast("批量驳回时请填写原因");
    return;
  }
  await apiFetch("/admin/api/reviews/batch", {
    method: "POST",
    body: JSON.stringify({
      review_status: reviewStatus,
      review_note: note.trim(),
      items,
    }),
  });
  state.reviewSelection.clear();
  showToast(`已批量${reviewStatus === "approved" ? "通过" : "驳回"} ${items.length} 条内容`);
  await Promise.all([loadOverview(), loadReviewQueue(), loadServices(), loadExperiences(), loadLogs()]);
}

async function openDetail(bizType, itemId) {
  const path = bizType === "service"
    ? `/admin/api/services/${itemId}`
    : `/admin/api/experiences/${itemId}`;
  const detail = await apiFetch(path);
  fillDetailForm(bizType, detail);
  openDetailDrawer();
}

async function saveDetail(event) {
  event.preventDefault();
  const bizType = elements.detailBizType.value;
  const itemId = elements.detailItemId.value;
  const patch = {
    title: elements.detailTitleInput.value.trim(),
    category: elements.detailCategoryInput.value.trim(),
    location: elements.detailLocationInput.value.trim(),
    price_text: elements.detailPriceInput.value.trim(),
    cover_image_url: elements.detailCoverInput.value.trim(),
    image_urls: elements.detailImageUrlsInput.value.split("\n").map((item) => item.trim()).filter(Boolean),
    description: elements.detailDescriptionInput.value.trim(),
  };
  if (bizType === "service") {
    patch.sort_priority = Number(elements.detailPriorityInput.value || "0");
    patch.is_important = elements.detailImportantCheckbox.checked;
    patch.sync_to_square = elements.detailSquareCheckbox.checked;
    await updateService(itemId, patch);
  } else {
    await updateExperience(itemId, patch);
  }
  renderDetailImages(patch.cover_image_url, patch.image_urls);
  showToast("详情已保存");
}

async function submitLogin(event) {
  event.preventDefault();
  try {
    if (state.config.passwordLoginEnabled && elements.loginPasswordInput.value.trim()) {
      const result = await apiFetch("/admin/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: elements.loginUsernameInput.value.trim(),
          password: elements.loginPasswordInput.value,
        }),
        skipAuth: true,
      });
      setStoredToken(result.token);
      state.session.displayName = result.display_name || state.config.displayName;
    } else if (state.config.requiresToken) {
      const token = elements.loginTokenInput.value.trim() || elements.loginPasswordInput.value.trim();
      if (!token) {
        showToast("请输入后台口令");
        return;
      }
      setStoredToken(token);
      state.session.displayName = state.config.displayName;
    } else {
      state.session.displayName = state.config.displayName;
    }
    updateSessionUI();
    closeLoginModal();
    await refreshAllData();
  } catch (error) {
    showToast(error.message);
  }
}

async function bootstrapConfig() {
  const config = await apiFetch("/admin/api/config", { skipAuth: true });
  state.config.requiresToken = Boolean(config.requires_token);
  state.config.passwordLoginEnabled = Boolean(config.password_login_enabled);
  state.config.defaultUsername = config.default_username || "admin";
  state.config.displayName = config.display_name || "平台管理员";
  state.config.sessionExpireHours = Number(config.session_expire_hours || 72);
  state.session.token = getStoredToken();
  state.session.displayName = state.session.token ? state.config.displayName : "未登录";
  updateSessionUI();
}

function bindPagination(buttonIdPrev, buttonIdNext, stateKey, loader) {
  document.getElementById(buttonIdPrev).addEventListener("click", () => {
    if (!canGoPrev(state[stateKey].page)) {
      return;
    }
    state[stateKey].page -= 1;
    loader().catch((error) => showToast(error.message));
  });
  document.getElementById(buttonIdNext).addEventListener("click", () => {
    if (!canGoNext(state[stateKey].page, state[stateKey].pageSize, state[stateKey].total)) {
      return;
    }
    state[stateKey].page += 1;
    loader().catch((error) => showToast(error.message));
  });
}

function bindEvents() {
  document.getElementById("refreshAllButton").addEventListener("click", () => {
    refreshAllData().catch((error) => showToast(error.message));
  });
  document.getElementById("openLoginButton").addEventListener("click", openLoginModal);
  document.getElementById("logoutButton").addEventListener("click", () => {
    clearStoredSession();
    openLoginModal();
  });
  document.getElementById("closeLoginButton").addEventListener("click", closeLoginModal);
  document.getElementById("reviewRefreshButton").addEventListener("click", () => loadReviewQueue().catch((error) => showToast(error.message)));
  document.getElementById("bulkApproveButton").addEventListener("click", () => runBatchReview("approved").catch((error) => showToast(error.message)));
  document.getElementById("bulkRejectButton").addEventListener("click", () => runBatchReview("rejected").catch((error) => showToast(error.message)));
  document.getElementById("logsRefreshButton").addEventListener("click", () => loadLogs().catch((error) => showToast(error.message)));
  document.getElementById("closeDrawerButton").addEventListener("click", closeDetailDrawer);
  document.getElementById("drawerOverlay").addEventListener("click", closeDetailDrawer);

  elements.loginForm.addEventListener("submit", submitLogin);
  elements.detailForm.addEventListener("submit", (event) => saveDetail(event).catch((error) => showToast(error.message)));

  document.getElementById("userSearchButton").addEventListener("click", () => {
    state.users.page = 1;
    loadUsers().catch((error) => showToast(error.message));
  });
  document.getElementById("serviceSearchButton").addEventListener("click", () => {
    state.services.page = 1;
    loadServices().catch((error) => showToast(error.message));
  });
  document.getElementById("experienceSearchButton").addEventListener("click", () => {
    state.experiences.page = 1;
    loadExperiences().catch((error) => showToast(error.message));
  });
  document.getElementById("feedbackSearchButton").addEventListener("click", () => {
    state.feedbacks.page = 1;
    loadFeedbacks().catch((error) => showToast(error.message));
  });

  bindPagination("usersPrevButton", "usersNextButton", "users", loadUsers);
  bindPagination("servicesPrevButton", "servicesNextButton", "services", loadServices);
  bindPagination("experiencesPrevButton", "experiencesNextButton", "experiences", loadExperiences);
  bindPagination("feedbackPrevButton", "feedbackNextButton", "feedbacks", loadFeedbacks);
  bindPagination("logsPrevButton", "logsNextButton", "logs", loadLogs);

  elements.reviewSelectAll.addEventListener("change", (event) => {
    const checkboxes = elements.reviewQueueTable.querySelectorAll("[data-review-checkbox='true']");
    if (event.target.checked) {
      checkboxes.forEach((checkbox) => {
        state.reviewSelection.add(reviewKey(checkbox.dataset.reviewBiz, checkbox.dataset.reviewId));
        checkbox.checked = true;
      });
      return;
    }
    checkboxes.forEach((checkbox) => {
      state.reviewSelection.delete(reviewKey(checkbox.dataset.reviewBiz, checkbox.dataset.reviewId));
      checkbox.checked = false;
    });
  });

  elements.usersTable.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-user-id]");
    if (!target) {
      return;
    }
    try {
      await updateUser(target.dataset.userId, {
        [target.dataset.userField]: target.dataset.userNext === "true",
      });
    } catch (error) {
      showToast(error.message);
    }
  });

  elements.reviewQueueTable.addEventListener("change", (event) => {
    const target = event.target.closest("[data-review-checkbox='true']");
    if (!target) {
      return;
    }
    const key = reviewKey(target.dataset.reviewBiz, target.dataset.reviewId);
    if (target.checked) {
      state.reviewSelection.add(key);
    } else {
      state.reviewSelection.delete(key);
    }
  });

  elements.reviewQueueTable.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-review-id]");
    if (!target) {
      return;
    }
    const bizType = target.dataset.reviewBiz;
    const itemId = target.dataset.reviewId;
    const action = target.dataset.reviewAction;
    try {
      if (action === "detail") {
        await openDetail(bizType, itemId);
      } else if (action === "approve") {
        const note = askForNote("审核通过", "填写审核通过备注");
        if (note === null) {
          return;
        }
        if (bizType === "service") {
          await updateService(itemId, { review_status: "approved", review_note: note.trim() || "审核通过" });
        } else {
          await updateExperience(itemId, { review_status: "approved", review_note: note.trim() || "审核通过" });
        }
      } else if (action === "reject") {
        const note = askForNote("", "填写驳回原因");
        if (note === null) {
          return;
        }
        if (!note.trim()) {
          showToast("请填写驳回原因");
          return;
        }
        if (bizType === "service") {
          await updateService(itemId, { review_status: "rejected", review_note: note.trim() });
        } else {
          await updateExperience(itemId, { review_status: "rejected", review_note: note.trim() });
        }
      }
    } catch (error) {
      showToast(error.message);
    }
  });

  elements.servicesTable.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-service-id]");
    if (!target) {
      return;
    }
    const serviceId = target.dataset.serviceId;
    const action = target.dataset.serviceAction;
    try {
      if (action === "detail") {
        await openDetail("service", serviceId);
      } else if (action === "toggle-delete") {
        await updateService(serviceId, { is_deleted: target.dataset.serviceNext === "true" });
      } else if (action === "toggle-draft") {
        await updateService(serviceId, { is_draft: target.dataset.serviceNext === "true" });
      } else if (action === "toggle-square") {
        await updateService(serviceId, { sync_to_square: target.dataset.serviceNext === "true" });
      } else if (action === "toggle-important") {
        await updateService(serviceId, { is_important: target.dataset.serviceNext === "true" });
      } else if (action === "set-priority") {
        const currentPriority = Number(target.dataset.servicePriority || "0");
        const value = askForNote(String(currentPriority), "填写服务优先级，数字越大排序越靠前");
        if (value === null) {
          return;
        }
        const nextPriority = Number(value);
        if (!Number.isFinite(nextPriority) || nextPriority < 0) {
          showToast("请输入大于等于 0 的数字");
          return;
        }
        await updateService(serviceId, { sort_priority: Math.floor(nextPriority) });
      } else if (action === "review-approve") {
        const note = askForNote("审核通过", "填写审核通过备注");
        if (note === null) {
          return;
        }
        await updateService(serviceId, { review_status: "approved", review_note: note.trim() || "审核通过" });
      } else if (action === "review-reject") {
        const note = askForNote("", "填写驳回原因");
        if (note === null) {
          return;
        }
        if (!note.trim()) {
          showToast("请填写驳回原因");
          return;
        }
        await updateService(serviceId, { review_status: "rejected", review_note: note.trim() });
      }
    } catch (error) {
      showToast(error.message);
    }
  });

  elements.experiencesTable.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-experience-id]");
    if (!target) {
      return;
    }
    const experienceId = target.dataset.experienceId;
    const action = target.dataset.experienceAction;
    try {
      if (action === "detail") {
        await openDetail("experience", experienceId);
      } else if (action === "toggle-delete") {
        await updateExperience(experienceId, { is_deleted: target.dataset.experienceNext === "true" });
      } else if (action === "review-approve") {
        const note = askForNote("审核通过", "填写审核通过备注");
        if (note === null) {
          return;
        }
        await updateExperience(experienceId, { review_status: "approved", review_note: note.trim() || "审核通过" });
      } else if (action === "review-reject") {
        const note = askForNote("", "填写驳回原因");
        if (note === null) {
          return;
        }
        if (!note.trim()) {
          showToast("请填写驳回原因");
          return;
        }
        await updateExperience(experienceId, { review_status: "rejected", review_note: note.trim() });
      }
    } catch (error) {
      showToast(error.message);
    }
  });

  elements.feedbackTable.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-feedback-id]");
    if (!target) {
      return;
    }
    const feedbackId = target.dataset.feedbackId;
    try {
      if (target.dataset.feedbackAction === "note") {
        const note = askForNote("", "填写跟进备注");
        if (note === null) {
          return;
        }
        await updateFeedback(feedbackId, { admin_note: note.trim() });
        return;
      }
      const nextStatus = target.dataset.feedbackStatus;
      if (!nextStatus) {
        return;
      }
      const note = askForNote("", "可选：填写状态更新备注");
      if (note === null) {
        return;
      }
      await updateFeedback(feedbackId, {
        status: nextStatus,
        admin_note: note.trim(),
      });
    } catch (error) {
      showToast(error.message);
    }
  });
}

async function init() {
  bindEvents();
  try {
    await bootstrapConfig();
    if (state.session.token || (!state.config.requiresToken && !state.config.passwordLoginEnabled)) {
      await refreshAllData();
    } else {
      openLoginModal();
    }
  } catch (error) {
    showToast(error.message);
  }
}

init();
