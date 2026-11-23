/* ==========================================================
   业务脚本（由原 index7.txt 中的三段 <script> 按原顺序合并）
   仅做文件拆分，内部逻辑一行未改
   ========================================================== */

/* ---------- 脚本块 1：状态栏时间等原始逻辑 ---------- */
    (function () {
        // 状态栏时间：跟随本机真实时间
        var sbTime = document.getElementById('sbTime');
        function pad(n) { return n < 10 ? '0' + n : '' + n; }
        function tick() {
            var d = new Date();
            sbTime.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
        }
        tick();
        setInterval(tick, 10000);

        // 真机（iOS / Android 浏览器）：系统自带状态栏与 Home 条，页面不再重复自绘
        var ua = navigator.userAgent || '';
        var mobile = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(ua);
        var standalone = window.navigator.standalone === true ||
                         (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
        if (mobile || standalone) {
            document.documentElement.classList.add('real-device');
        }

        // ===== TabBar 切换 =====
        var tabs = document.querySelectorAll('.tabbar .tab');
        var pages = document.querySelectorAll('.pages .page');
        var indexBar = document.getElementById('indexBar');

        Array.prototype.forEach.call(tabs, function (tab) {
            tab.addEventListener('click', function () {
                var id = tab.getAttribute('data-page');
                if (!id) return;

                Array.prototype.forEach.call(tabs, function (t) { t.classList.remove('active'); });
                tab.classList.add('active');

                Array.prototype.forEach.call(pages, function (p) {
                    p.classList.toggle('active', p.id === id);
                });

                document.querySelector('.app').classList.toggle('me-active', id === 'page-me');
                if (indexBar) indexBar.classList.toggle('show', id === 'page-contacts');

                var target = document.getElementById(id);
                if (target) target.scrollTop = 0;
            });
        });

        // 禁掉双击放大
        var lastTouch = 0;
        document.addEventListener('touchend', function (e) {
            var now = Date.now();
            if (now - lastTouch < 300) { e.preventDefault(); }
            lastTouch = now;
        }, { passive: false });
    })();

/* ---------- 脚本块 2：页面跳转、聊天交互、PWA 注册 ---------- */
/* ==========================================================
   新增脚本：页面跳转、聊天交互、PWA 注册
   原有 <script> 一行未改，本块为独立追加
   ========================================================== */
(function () {
    var app = document.querySelector('.app');
    var pages = document.querySelectorAll('.pages .page');
    var tabs = document.querySelectorAll('.tabbar .tab');
    var indexBar = document.getElementById('indexBar');
    var toastEl = document.getElementById('toast');
    var chatScroll = document.getElementById('chatScroll');
    var msgList = document.getElementById('msgList');
    var chatInput = document.getElementById('chatInput');
    var chatSend = document.getElementById('chatSend');
    var plusBtn = document.getElementById('plusBtn');
    var bubMenu = document.getElementById('bubMenu');
    var editMask = document.getElementById('editMask');
    var editInput = document.getElementById('editInput');
    var plusMenu = document.getElementById('plusMenu');

    var currentBub = null;
    var currentTimeEl = null;
    var currentMsgRow = null;
    var returnPage = 'page-chats';
    var toastTimer = null;

    /* ---- 单聊新增：头像 / 名称 / 支付 / 表情 相关的元素与状态 ---- */
    var chatTitleEl = document.getElementById('chatTitleText');
    var emojiBtn = document.getElementById('emojiBtn');
    var emojiPanel = document.getElementById('emojiPanel');
    var emojiGrid = document.getElementById('emojiGrid');
    var plusPanel = document.getElementById('chatPlusPanel');
    var chatAvatarInput = document.getElementById('chatAvatarInput');
    var chatNameMask = document.getElementById('chatNameMask');
    var chatNameInput = document.getElementById('chatNameInput');
    var moneyMask = document.getElementById('moneyMask');
    var moneyInput = document.getElementById('moneyInput');
    var payMask = document.getElementById('payMask');
    var payTitleEl = document.getElementById('payTitle');
    var payTextEl = document.getElementById('payText');
    var payCancelEl = document.getElementById('payCancel');
    var payOkEl = document.getElementById('payOk');

    var AV_KEY = 'wechat_chat_avatars_v1';
    var avatarStore = {};
    try { avatarStore = JSON.parse(localStorage.getItem(AV_KEY) || '{}') || {}; } catch (e) { avatarStore = {}; }

    /* 聊天记录持久化：按会话名分别保存 */
    var MSG_KEY = 'wechat_chat_msgs_v1';
    var chatMsgs = {};
    try { chatMsgs = JSON.parse(localStorage.getItem(MSG_KEY) || '{}') || {}; } catch (e) { chatMsgs = {}; }

    /* 历史昵称迁移：老版本可能把默认昵称/微信号写进本地缓存，聊天记录与头像按会话名索引。
       把旧键的数据挪到新键，改名后原聊天记录、头像、资料都不会丢。 */
    (function () {
        var OLD = '肥二' + '不抽烟', OLD_ID = 'huan' + 'ceo88';
        var NEW = '直接收米', NEW_ID = 'ask568988';
        var changed = false;
        if (avatarStore[OLD]) {
            if (!avatarStore[NEW]) { avatarStore[NEW] = avatarStore[OLD]; }
            delete avatarStore[OLD];
            changed = true;
        }
        if (chatMsgs[OLD] && !chatMsgs[NEW]) { chatMsgs[NEW] = chatMsgs[OLD]; changed = true; }
        if (chatMsgs[OLD]) { delete chatMsgs[OLD]; }
        try {
            var prof = JSON.parse(localStorage.getItem('wechat_me_profile_v1') || 'null');
            if (prof) {
                var pChanged = false;
                if (prof.name === OLD) { prof.name = NEW; pChanged = true; }
                if (prof.wxid === OLD_ID) { prof.wxid = NEW_ID; pChanged = true; }
                if (pChanged) { localStorage.setItem('wechat_me_profile_v1', JSON.stringify(prof)); }
            }
        } catch (e) {}
        if (changed) {
            try {
                localStorage.setItem(AV_KEY, JSON.stringify(avatarStore));
                localStorage.setItem(MSG_KEY, JSON.stringify(chatMsgs));
            } catch (e) {}
        }
    })();

    var restoringChat = false;
    var pageChatEl = document.getElementById('page-chat');
    var currentChatName = '';
    var currentChatKey = '';
    var avatarTargetRole = 'other';
    /* 当前发言身份：me=右侧（我），other=左侧（对方）。单击哪边头像就以哪边发送 */
    var sendAs = 'me';
    var emojiRendered = false;
    var payAction = null;

    function toast(text) {
        toastEl.textContent = text;
        toastEl.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1500);
    }

    function hideBubMenu() { bubMenu.classList.remove('show'); }
    function hidePlus() { plusMenu.classList.remove('show'); }

    /* 显示某一页；isSub = 是否隐藏底部 Tab */
    function showPage(id, isSub) {
        Array.prototype.forEach.call(pages, function (p) {
            p.classList.toggle('active', p.id === id);
        });
        app.classList.toggle('subpage-open', !!isSub);
        app.classList.remove('me-active');
        if (indexBar) indexBar.classList.toggle('show', id === 'page-contacts');
        var el = document.getElementById(id);
        if (el) el.scrollTop = 0;
        hidePlus();
        hideBubMenu();
        if (typeof hideChatPanels === 'function') { hideChatPanels(); }
    }

    /* 第一次进入子页时压一条历史，让手机返回键也能回列表 */
    function enterSub() {
        if (app.classList.contains('subpage-open')) return;
        var cur = document.querySelector('.page.active');
        returnPage = cur ? cur.id : 'page-chats';
        try { history.pushState({ sub: 1 }, ''); } catch (e) {}
    }

    function backToTabs() {
        if (currentChatKey) { saveChatMessages(); }
        showPage(returnPage, false);
        Array.prototype.forEach.call(tabs, function (t) {
            t.classList.toggle('active', t.getAttribute('data-page') === returnPage);
        });
        if (returnPage === 'page-me') app.classList.add('me-active');
    }

    function goBack() {
        hideBubMenu();
        hidePlus();
        try {
            if (history.state && history.state.sub) { history.back(); return; }
        } catch (e) {}
        backToTabs();
    }

    window.addEventListener('popstate', function () {
        if (app.classList.contains('subpage-open')) backToTabs();
    });

    window.addEventListener('pagehide', function () {
        if (currentChatKey) { saveChatMessages(); }
    });

    /* 头像占位图：渐变/深色块 + 人像剪影，换成 <img> 即可用真实图片 */
    function avatarSvg(kind) {
        if (kind === 'me') {
            /* 与「我」页默认头像保持一致 */
            return '<svg viewBox="0 0 52 52" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">' +
                   '<rect width="52" height="52" fill="#1A1A1A"/>' +
                   '<circle cx="26" cy="19.5" r="9" fill="#6E6E6E"/>' +
                   '<path d="M7 52c0-9.6 8.5-14.6 19-14.6S45 42.4 45 52z" fill="#6E6E6E"/>' +
                   '<path d="M17 15c1.6-6 4.6-8.6 9-8.6s7.4 2.6 9 8.6c-2.6-2.4-5.6-3.6-9-3.6s-6.4 1.2-9 3.6z" fill="#1C1C1C"/>' +
                   '</svg>';
        }
        return '<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">' +
               '<rect width="40" height="40" fill="#8FA6B8"/>' +
               '<circle cx="20" cy="15" r="6.4" fill="rgba(255,255,255,.85)"/>' +
               '<path d="M7 40c0-7.6 5.8-11.6 13-11.6S33 32.4 33 40z" fill="rgba(255,255,255,.85)"/>' +
               '</svg>';
    }

    /* 「我」页保存的头像，聊天右侧头像直接读它，保证同步 */
    var ME_KEY = 'wechat_me_profile_v1';
    function meProfileAvatar() {
        try {
            var d = JSON.parse(localStorage.getItem(ME_KEY) || 'null');
            return d && d.avatar ? d.avatar : '';
        } catch (e) { return ''; }
    }

    function scrollBottom() {
        if (chatScroll) chatScroll.scrollTop = chatScroll.scrollHeight;
    }

    /* 当前会话里某一方的头像；右侧「我」始终跟「我」页同步 */
    function chatAvatarFor(who) {
        if (who === 'me') { return meProfileAvatar(); }
        var d = avatarStore[currentChatKey];
        return d && d[who] ? d[who] : '';
    }

    function avatarInner(who) {
        var src = chatAvatarFor(who);
        return src ? '<img src="' + src + '" alt="">' : avatarSvg(who);
    }

    /* ---- 聊天记录读写（头像不重复存，恢复时用 avatarStore 填回） ---- */
    function writeMsgStore() {
        try { localStorage.setItem(MSG_KEY, JSON.stringify(chatMsgs)); } catch (e) {}
    }

    function fmtClock(d) {
        var hh = d.getHours();
        var mm = d.getMinutes();
        return (hh < 10 ? '0' + hh : '' + hh) + ':' + (mm < 10 ? '0' + mm : '' + mm);
    }

    /* 取最后一条真正的消息做会话列表摘要 */
    function lastMessagePreview() {
        var nodes = msgList.children;
        for (var i = nodes.length - 1; i >= 0; i--) {
            var el = nodes[i];
            if (!el.classList || !el.classList.contains('msg')) { continue; }
            var emo = el.querySelector('.bub.emoji img');
            if (emo) { return '[' + (emo.getAttribute('alt') || '表情') + ']'; }
            var txt = el.querySelector('.bub.text');
            if (txt) { return txt.textContent.replace(/\s+/g, ' ').trim(); }
            var card = el.querySelector('.pay-card');
            if (card) { return card.classList.contains('rp') ? '[微信红包]' : '[转账]'; }
        }
        return '';
    }

    function syncChatRow(name, preview, listTime) {
        var row = findChatRow(name);
        if (!row) { return; }
        var msgEl = row.querySelector('.row-msg');
        if (msgEl && typeof preview === 'string') { msgEl.textContent = preview; }
        var timeEl = row.querySelector('.row-time');
        if (timeEl && listTime) { timeEl.textContent = listTime; }
    }

    function saveChatMessages(touch) {
        if (!currentChatKey || restoringChat) { return; }
        var clone = msgList.cloneNode(true);
        Array.prototype.forEach.call(clone.querySelectorAll('.mav'), function (m) {
            m.innerHTML = '';
        });
        var entry = chatMsgs[currentChatKey] || {};
        entry.time = document.getElementById('chatTimeText').textContent;
        entry.html = clone.innerHTML;
        entry.preview = lastMessagePreview();
        if (touch) {
            entry.listTime = fmtClock(new Date());
            syncChatRow(currentChatKey, entry.preview, entry.listTime);
        }
        chatMsgs[currentChatKey] = entry;
        writeMsgStore();
    }

    function applyListPreviews() {
        Object.keys(chatMsgs).forEach(function (name) {
            var d = chatMsgs[name];
            if (!d || !d.listTime) { return; }
            syncChatRow(name, typeof d.preview === 'string' ? d.preview : '', d.listTime);
        });
    }

    function restoreChatMessages(saved) {
        msgList.innerHTML = saved.html || '';
        Array.prototype.forEach.call(msgList.querySelectorAll('.msg'), function (row) {
            var who = row.classList.contains('me') ? 'me' : 'other';
            var mav = row.querySelector('.mav');
            if (mav) {
                mav.setAttribute('data-role', who);
                mav.innerHTML = avatarInner(who);
            }
        });
        /* 兼容旧记录：补齐转账完成卡的圆圈，金额统一补成两位小数 */
        Array.prototype.forEach.call(msgList.querySelectorAll('.pay-card'), function (card) {
            var money = card.querySelector('.tc-money');
            if (money) {
                var m = money.textContent.match(/-?\d+(\.\d+)?/);
                if (m) { money.textContent = '¥' + Number(m[0]).toFixed(2); }
            }
            var check = card.querySelector('.tc-check');
            if (check) { check.innerHTML = doneCheckSvg(); }
        });
    }

    /* 通用消息节点：inner 为气泡 / 卡片 / 表情的 HTML */
    function appendMsgNode(who, inner) {
        var row = document.createElement('div');
        row.className = 'msg ' + who;
        row.innerHTML = '<div class="mav" data-role="' + who + '">' + avatarInner(who) + '</div>' + inner;
        msgList.appendChild(row);
        scrollBottom();
        if (!restoringChat) { saveChatMessages(true); }
        return row;
    }

    function addMsg(text, who) {
        var row = appendMsgNode(who, '<div class="bub text"></div>');
        row.querySelector('.bub').textContent = text;
        if (!restoringChat) { saveChatMessages(true); }
        return row;
    }

    /* 自定义会话（含添加时填写的内容） */
    function findCustomChat(name) {
        var arr = readCustom();
        for (var i = 0; i < arr.length; i++) {
            if (arr[i].name === name) { return arr[i]; }
        }
        return null;
    }

    /* ---- 会话列表 → 聊天页 ---- */
    function openChat(name, empty) {
        enterSub();
        currentChatName = name;
        currentChatKey = name;
        hideChatPanels();
        document.getElementById('chatTitleText').textContent = name;
        var saved = chatMsgs[name];
        var cu = findCustomChat(name);
        document.getElementById('chatTimeText').textContent =
            saved ? (saved.time || '') : (empty ? '' : '上午 9:41');
        sendAs = 'me';
        msgList.innerHTML = '';
        restoringChat = true;
        if (saved) {
            restoreChatMessages(saved);
        } else if (cu) {
            /* 添加会话时填写的内容 → 对方（左侧）的第一条消息 */
            if (cu.content) { addMsg(cu.content, 'other'); }
        } else if (!empty) {
            addMsg('在吗？', 'other');
            addMsg('在的，怎么啦', 'me');
            addMsg('这个页面做得怎么样了', 'other');
            addMsg('快好了，等下发你看看', 'me');
        }
        restoringChat = false;
        if (!saved) {
            if (cu && cu.content) { saveChatMessages(true); }
            else if (!cu && !empty) { saveChatMessages(); }
        }
        showPage('page-chat', true);
        setTimeout(scrollBottom, 30);
    }

    Array.prototype.forEach.call(document.querySelectorAll('#page-chats .list .row'), function (row) {
        row.addEventListener('click', function () {
            var n = row.querySelector('.row-name');
            openChat(n ? n.textContent.trim() : '微信');
        });
    });

    /* ---- 通讯录：联系人 → 资料页；头像/名字/微信号可修改并持久化 ---- */
    var CONTACT_KEY = 'wechat_contact_profiles_v1';
    var contactProfiles = {};
    try { contactProfiles = JSON.parse(localStorage.getItem(CONTACT_KEY) || '{}') || {}; } catch (e) { contactProfiles = {}; }
    var profileKey = '阿光';
    var pEditField = 'name';

    function saveContactProfiles() {
        try { localStorage.setItem(CONTACT_KEY, JSON.stringify(contactProfiles)); return true; }
        catch (e) { return false; }
    }

    function contactProfile(key) {
        var p = contactProfiles[key];
        if (!p) {
            p = {
                name: key,
                wxid: 'wxid_' + (key === '阿光' ? 'aguang' : 'aming') + '_01',
                avatar: ''
            };
            contactProfiles[key] = p;
        }
        return p;
    }

    function contactRow(key) {
        var rows = document.querySelectorAll('#page-contacts .cell[data-cid]');
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].getAttribute('data-cid') === key) { return rows[i]; }
        }
        return null;
    }

    function paintContactRow(key) {
        var row = contactRow(key);
        if (!row) { return; }
        var p = contactProfile(key);
        var t = row.querySelector('.cell-title');
        if (t) { t.textContent = p.name; }
        var av = row.querySelector('.avatar-sq');
        if (av && p.avatar) { av.innerHTML = '<img src="' + p.avatar + '" alt="">'; }
    }

    function paintProfile() {
        var p = contactProfile(profileKey);
        document.getElementById('profileName').textContent = p.name;
        document.getElementById('profileId').textContent = '微信号：' + p.wxid;
        document.getElementById('profileAvatar').innerHTML = p.avatar
            ? '<img src="' + p.avatar + '" alt="">'
            : avatarSvg('other');
    }

    function openProfile(key) {
        profileKey = key;
        enterSub();
        paintProfile();
        showPage('page-profile', true);
    }

    Array.prototype.forEach.call(document.querySelectorAll('#page-contacts .cell'), function (cell) {
        cell.addEventListener('click', function () {
            var key = cell.getAttribute('data-cid');
            var t = cell.querySelector('.cell-title');
            var name = t ? t.textContent.trim() : '';
            if (key) { openProfile(key); }
            else if (name) { toast(name + ' · 演示版暂未展开'); }
        });
    });

    /* 启动时把改过的名字 / 头像铺回通讯录 */
    Object.keys(contactProfiles).forEach(paintContactRow);

    /* 资料页：点头像 → 选图 → 裁剪 → 保存 */
    var pAvatarInput = document.getElementById('profileAvatarInput');
    document.getElementById('profileAvatar').addEventListener('click', function () { pAvatarInput.click(); });
    pAvatarInput.addEventListener('change', function () {
        var f = pAvatarInput.files && pAvatarInput.files[0];
        pAvatarInput.value = '';
        if (!f) { return; }
        if (!/^image\//.test(f.type)) { toast('请选择图片文件'); return; }
        var reader = new FileReader();
        reader.onload = function () {
            if (typeof window.openCropper !== 'function') { toast('裁剪组件未加载'); return; }
            window.openCropper(reader.result, function (src) {
                var p = contactProfile(profileKey);
                var old = p.avatar;
                p.avatar = src;
                if (!saveContactProfiles()) {
                    p.avatar = old;
                    toast('存储空间不足，换张小图试试');
                    return;
                }
                paintContactRow(profileKey);
                paintProfile();
                /* 聊天页里这个联系人的头像同步过去 */
                if (!avatarStore[p.name]) { avatarStore[p.name] = {}; }
                avatarStore[p.name].other = src;
                saveAvatars();
                toast('头像已更新');
            });
        };
        reader.readAsDataURL(f);
    });

    /* 资料页：点名字 / 微信号 → 弹框修改 */
    function openPEdit(field) {
        pEditField = field;
        var p = contactProfile(profileKey);
        var title = document.getElementById('pEditTitle');
        var input = document.getElementById('pEditInput');
        if (field === 'name') {
            title.textContent = '修改名字';
            input.value = p.name;
            input.maxLength = 16;
        } else {
            title.textContent = '修改微信号';
            input.value = p.wxid;
            input.maxLength = 20;
        }
        document.getElementById('pEditMask').classList.add('show');
        setTimeout(function () { input.focus(); input.select(); }, 60);
    }

    document.getElementById('profileName').addEventListener('click', function () { openPEdit('name'); });
    document.getElementById('profileId').addEventListener('click', function () { openPEdit('wxid'); });

    document.getElementById('pEditCancel').addEventListener('click', function () {
        document.getElementById('pEditMask').classList.remove('show');
    });

    document.getElementById('pEditSave').addEventListener('click', function () {
        var input = document.getElementById('pEditInput');
        var v = input.value.trim();
        var p = contactProfile(profileKey);
        var oldName = p.name;
        if (pEditField === 'name') {
            if (!v) { toast('名字不能为空'); return; }
            if (v.length > 16) { toast('名字最多 16 个字'); return; }
            p.name = v;
        } else {
            if (!/^[A-Za-z][A-Za-z0-9_-]{5,19}$/.test(v)) {
                toast('微信号需 6-20 位、字母开头');
                return;
            }
            p.wxid = v;
        }
        if (!saveContactProfiles()) { toast('保存失败，请清理浏览器存储'); return; }
        if (pEditField === 'name' && oldName !== p.name && avatarStore[oldName]) {
            avatarStore[p.name] = avatarStore[oldName];
            delete avatarStore[oldName];
            saveAvatars();
        }
        paintContactRow(profileKey);
        paintProfile();
        document.getElementById('pEditMask').classList.remove('show');
        toast('已保存');
    });

    document.getElementById('pEditInput').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); document.getElementById('pEditSave').click(); }
    });
    document.getElementById('pEditMask').addEventListener('click', function (e) {
        if (e.target === this) { this.classList.remove('show'); }
    });

    document.getElementById('profileSend').addEventListener('click', function () {
        openChat(document.getElementById('profileName').textContent);
    });

    /* ---- 发现 / 我 / 资料页列表：点哪都有反馈 ---- */
    Array.prototype.forEach.call(
        document.querySelectorAll('#page-discover .cell, #page-me .cell, #page-profile .prow'),
        function (cell) {
            cell.addEventListener('click', function () {
                var t = cell.querySelector('.cell-title') || cell.querySelector('.prow span') || cell.querySelector('span');
                toast((t ? t.textContent.trim() : '该功能') + ' · 演示版暂未展开');
            });
        }
    );

    /* ---- 返回按钮 ---- */
    document.getElementById('chatBack').addEventListener('click', goBack);
    document.getElementById('profileBack').addEventListener('click', goBack);
    document.getElementById('chatMore').addEventListener('click', function () {
        toast('聊天信息 · 演示版暂未展开');
    });

    /* ---- 输入与发送 ---- */
    function updateSend() {
        var has = chatInput.value.trim().length > 0;
        chatSend.classList.toggle('show', has);
        plusBtn.style.display = has ? 'none' : 'flex';
        if (has) { hideChatPanels(); }
    }
    /* 输入框随内容自动增高，超过约 4 行后内部滚动 */
    function resizeChatInput() {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 102) + 'px';
    }
    function send() {
        var v = chatInput.value.trim();
        if (!v) return;
        addMsg(v, sendAs);
        chatInput.value = '';
        chatInput.style.height = '';
        resizeChatInput();
        updateSend();
        chatInput.focus();
    }
    chatInput.addEventListener('input', function () {
        updateSend();
        resizeChatInput();
    });
    chatInput.addEventListener('focus', function () {
        hideChatPanels();
        setTimeout(scrollBottom, 300);
    });
    chatInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    });
    chatSend.addEventListener('click', send);


    /* 编辑 / 删除 菜单：文字气泡、时间都能用；delOnly 时只留「删除」 */
    function showMsgMenu(el, delOnly) {
        bubMenu.classList.toggle('only-del', !!delOnly);
        bubMenu.classList.add('show');
        var r = el.getBoundingClientRect();
        var mw = bubMenu.offsetWidth;
        var mh = bubMenu.offsetHeight;
        var sr = chatScroll.getBoundingClientRect();
        var left = Math.max(8, Math.min(window.innerWidth - mw - 8, r.left + r.width / 2 - mw / 2));
        bubMenu.style.left = left + 'px';
        var top = r.top - mh - 8;
        var below = false;
        if (top < sr.top + 6) { top = r.bottom + 8; below = true; }
        if (top + mh > sr.bottom - 6) { top = Math.max(sr.top + 6, sr.bottom - mh - 6); }
        bubMenu.classList.toggle('below', below);
        bubMenu.style.top = top + 'px';
    }

    /* ---- 单击消息：头像切换发言方向 / 卡片收款 / 时间与文字编辑删除 ---- */
    msgList.addEventListener('click', function (e) {
        var mav = e.target.closest ? e.target.closest('.mav') : null;
        if (mav) {
            sendAs = mav.getAttribute('data-role') === 'other' ? 'other' : 'me';
            toast(sendAs === 'me'
                ? '现在以「我」的身份发送'
                : '现在以「' + currentChatName + '」的身份发送');
            return;
        }
        var card = e.target.closest ? e.target.closest('.pay-card') : null;
        if (card) {
            /* 已领取 / 已收款的卡片：单击只弹删除；未领取的仍然走收款流程 */
            if (card.classList.contains('done')) {
                currentBub = null;
                currentTimeEl = null;
                currentMsgRow = card.closest ? card.closest('.msg') : null;
                showMsgMenu(card, true);
            } else {
                handlePayCard(card);
            }
            return;
        }

        /* 表情：单击弹出删除 */
        var emo = e.target.closest ? e.target.closest('.bub.emoji') : null;
        if (emo) {
            currentBub = null;
            currentTimeEl = null;
            currentMsgRow = emo.closest ? emo.closest('.msg') : null;
            showMsgMenu(emo, true);
            return;
        }

        var tEl = e.target.closest ? e.target.closest('.chat-time') : null;
        if (tEl) {
            currentBub = null;
            currentMsgRow = null;
            currentTimeEl = tEl;
            showMsgMenu(tEl);
            return;
        }

        var bub = e.target.closest ? e.target.closest('.bub.text') : null;
        if (!bub) { hideBubMenu(); return; }
        currentTimeEl = null;
        currentMsgRow = null;
        currentBub = bub;
        showMsgMenu(bub);
    });

    /* 顶部那条时间（在消息列表外）也能点 */
    document.getElementById('chatTimeText').addEventListener('click', function () {
        currentBub = null;
        currentMsgRow = null;
        currentTimeEl = this;
        showMsgMenu(this);
    });

    document.getElementById('bubEdit').addEventListener('click', function () {
        var target = currentTimeEl || currentBub;
        if (!target) return;
        editInput.value = target.textContent.trim();
        document.querySelector('#editMask .eb-title').textContent =
            currentTimeEl ? '编辑时间' : '编辑聊天内容';
        editMask.classList.add('show');
        hideBubMenu();
        setTimeout(function () { editInput.focus(); }, 60);
    });
    document.getElementById('bubDel').addEventListener('click', function () {
        var target = currentTimeEl || currentBub;
        if (!target && !currentMsgRow) return;
        if (currentMsgRow) {
            /* 表情 / 卡片：整条消息一起删掉（头像也不留空行） */
            if (currentMsgRow.parentNode) { currentMsgRow.parentNode.removeChild(currentMsgRow); }
        } else if (target.id === 'chatTimeText') {
            target.textContent = '';
        } else if (target && target.parentNode) {
            target.parentNode.removeChild(target);
        }
        currentBub = null;
        currentTimeEl = null;
        currentMsgRow = null;
        hideBubMenu();
        saveChatMessages(true);
    });
    document.getElementById('editCancel').addEventListener('click', function () {
        editMask.classList.remove('show');
    });
    document.getElementById('editSave').addEventListener('click', function () {
        var v = editInput.value.trim();
        if (!v) { toast('内容不能为空'); return; }
        if (currentTimeEl) { currentTimeEl.textContent = v; }
        else if (currentBub) { currentBub.textContent = v; }
        editMask.classList.remove('show');
        scrollBottom();
        saveChatMessages(true);
    });
    editMask.addEventListener('click', function (e) {
        if (e.target === editMask) editMask.classList.remove('show');
    });

    /* ==========================================================
       单聊新增：改头像、改网名、转账、红包、表情包
       ========================================================== */
    function saveAvatars() {
        try { localStorage.setItem(AV_KEY, JSON.stringify(avatarStore)); } catch (e) {}
    }

    function hideChatPanels() {
        emojiPanel.classList.remove('show');
        plusPanel.classList.remove('show');
        if (pageChatEl) { pageChatEl.classList.remove('panel-open'); }
    }

    function findChatRow(name) {
        var rows = document.querySelectorAll('#page-chats .list .row');
        for (var i = 0; i < rows.length; i++) {
            var t = rows[i].querySelector('.row-name .txt');
            if (t && t.textContent.trim() === name) { return rows[i]; }
        }
        return null;
    }

    function applyAvatar(role, src) {
        Array.prototype.forEach.call(
            msgList.querySelectorAll('.mav[data-role="' + role + '"]'),
            function (m) { m.innerHTML = '<img src="' + src + '" alt="">'; }
        );
        if (role === 'other') {
            var row = findChatRow(currentChatName);
            var av = row ? row.querySelector('.avatar') : null;
            if (av) { av.innerHTML = '<img src="' + src + '" alt="">'; }
        }
    }

    /* 聊天里改右侧头像 = 改「我」页头像，两边共用一份数据 */
    function storeMeAvatar(src) {
        if (typeof window.__setMeAvatar === 'function') {
            try { if (window.__setMeAvatar(src)) { return true; } } catch (e) {}
        }
        var prof = {};
        try { prof = JSON.parse(localStorage.getItem(ME_KEY) || '{}') || {}; } catch (e) { prof = {}; }
        prof.avatar = src;
        try { localStorage.setItem(ME_KEY, JSON.stringify(prof)); } catch (e) { return false; }
        var a = document.getElementById('meAvatar');
        if (a) { a.style.backgroundImage = 'url("' + src + '")'; a.classList.add('has-photo'); }
        var b = document.getElementById('infoAvatar');
        if (b) { b.style.backgroundImage = 'url("' + src + '")'; b.classList.add('has-photo'); }
        return true;
    }

    /* ---- 改头像：点聊天里的任意头像 ---- */
    chatAvatarInput.addEventListener('change', function (e) {
        var f = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!f) { return; }
        if (!/^image\//.test(f.type)) { toast('请选择图片文件'); return; }

        var reader = new FileReader();
        reader.onload = function () {
            openCropper(reader.result, function (src) {
                if (avatarTargetRole === 'me') {
                    if (!storeMeAvatar(src)) {
                        toast('存储空间不足，换张小图试试');
                        return;
                    }
                    applyAvatar('me', src);
                    toast('头像已更新');
                    return;
                }
                if (!avatarStore[currentChatKey]) { avatarStore[currentChatKey] = {}; }
                avatarStore[currentChatKey][avatarTargetRole] = src;
                saveAvatars();
                applyAvatar(avatarTargetRole, src);
                toast('头像已更新');
            });
        };
        reader.readAsDataURL(f);
    });

    /* ---- 改网名：点标题 ---- */
    chatTitleEl.addEventListener('click', function () {
        chatNameInput.value = chatTitleEl.textContent.trim();
        chatNameMask.classList.add('show');
        setTimeout(function () { chatNameInput.focus(); chatNameInput.select(); }, 60);
    });

    function closeChatName() { chatNameMask.classList.remove('show'); }
    document.getElementById('chatNameCancel').addEventListener('click', closeChatName);
    document.getElementById('chatNameOk').addEventListener('click', function () {
        var v = chatNameInput.value.trim();
        if (!v) { toast('名字不能为空'); return; }
        if (v.length > 16) { toast('名字最多 16 个字'); return; }
        var old = currentChatName;
        if (old && old !== v) {
            var row = findChatRow(old);
            var t = row ? row.querySelector('.row-name .txt') : null;
            if (t) { t.textContent = v; }
            /* 会话改名后，把聊天记录与头像一起迁到新名字下 */
            saveChatMessages();
            if (chatMsgs[old]) {
                chatMsgs[v] = chatMsgs[old];
                delete chatMsgs[old];
                writeMsgStore();
            }
            if (avatarStore[old]) {
                avatarStore[v] = avatarStore[old];
                delete avatarStore[old];
                saveAvatars();
            }
            currentChatKey = v;
        }
        currentChatName = v;
        chatTitleEl.textContent = v;
        closeChatName();
        toast('名称已修改');
    });

    chatNameInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); document.getElementById('chatNameOk').click(); }
    });
    chatNameMask.addEventListener('click', function (e) {
        if (e.target === chatNameMask) { closeChatName(); }
    });

    /* ---- 表情包 ---- */
    function renderEmojiPanel() {
        if (emojiRendered) { return; }
        emojiRendered = true;
        var list = window.WEIXIN_EMOJIS || [];
        for (var i = 0; i < list.length; i++) {
            (function (item) {
                var cell = document.createElement('div');
                cell.className = 'emoji-item';
                cell.title = item[0];
                var img = document.createElement('img');
                img.src = item[1];
                img.alt = item[0];
                cell.appendChild(img);
                cell.addEventListener('click', function () {
                    appendMsgNode(sendAs, '<div class="bub emoji"><img src="' + item[1] +
                                       '" alt="' + item[0] + '"></div>');
                });
                emojiGrid.appendChild(cell);
            })(list[i]);
        }
    }

    emojiBtn.addEventListener('click', function () {
        renderEmojiPanel();
        var willShow = !emojiPanel.classList.contains('show');
        plusPanel.classList.remove('show');
        emojiPanel.classList.toggle('show', willShow);
        if (pageChatEl) { pageChatEl.classList.toggle('panel-open', willShow); }
        chatInput.blur();
        setTimeout(scrollBottom, 60);
    });

    plusBtn.addEventListener('click', function () {
        var willShow = !plusPanel.classList.contains('show');
        emojiPanel.classList.remove('show');
        plusPanel.classList.toggle('show', willShow);
        if (pageChatEl) { pageChatEl.classList.toggle('panel-open', willShow); }
        chatInput.blur();
        setTimeout(scrollBottom, 60);
    });

    /* ---- 转账 / 红包 卡片 ---- */
    /* 转账金额固定保留两位小数，和微信一致（¥200.00） */
    function fmtMoney(amount) {
        var n = Number(amount);
        return isNaN(n) ? String(amount) : n.toFixed(2);
    }

    function transferHtml(amount, sub) {
        return '<div class="pay-card tc" data-type="transfer" data-amount="' + amount + '">' +
               '<div class="tc-ring"><svg viewBox="0 0 32 32" fill="none" stroke="#FFFFFF" ' +
               'stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">' +
               '<path d="M13.25 8.70 L7.30 13.45 H24.15"/>' +
               '<path d="M8.30 18.83 H24.15 L18.85 24.10"/></svg></div>' +
               '<div class="tc-info"><div class="tc-money">¥' + fmtMoney(amount) + '</div>' +
               '<div class="tc-sub">' + sub + '</div></div>' +
               '<span class="tc-tag">转账</span></div>';
    }

    function doneCheckSvg() {
        return '<svg viewBox="0 0 36 36" fill="none">' +
               '<circle cx="18" cy="18" r="16.2" stroke="#FFFFFF" stroke-width="2" fill="none"/>' +
               '<polyline points="10.8 18.6 15.6 23.2 25.2 13.2" stroke="#FFFFFF" stroke-width="2.2" ' +
               'stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }

    function transferDoneHtml(amount, status) {
        return '<div class="pay-card done">' +
               '<span class="tc-check">' + doneCheckSvg() + '</span>' +
               '<div class="tc-info"><div class="tc-money">¥' + fmtMoney(amount) + '</div>' +
               '<div class="tc-sub">' + status + '</div></div>' +
               '<span class="tc-tag">转账</span></div>';
    }

    function redPacketHtml() {
        return '<div class="pay-card rp" data-type="redpacket">' +
               '<div class="rp-env"><div class="rp-flap"></div><div class="rp-coin">￥</div></div>' +
               '<div class="rp-title">恭喜发财，大吉大利</div>' +
               '<div class="rp-sub">红包</div></div>';
    }

    function redPacketDoneHtml(amount) {
        return '<div class="pay-card rp done">' +
               '<div class="rp-env"><div class="rp-flap"></div><div class="rp-coin">￥</div></div>' +
               '<div class="rp-title">红包已领取</div>' +
               '<div class="rp-sub">¥' + amount + '</div></div>';
    }

    function openPay(title, text, cancelLabel, okLabel, fn) {
        payTitleEl.textContent = title;
        payTextEl.textContent = text || '';
        payTextEl.style.display = text ? 'block' : 'none';
        payCancelEl.textContent = cancelLabel;
        payOkEl.textContent = okLabel;
        payAction = typeof fn === 'function' ? fn : null;
        payMask.classList.add('show');
    }

    payOkEl.addEventListener('click', function () {
        payMask.classList.remove('show');
        if (payAction) { payAction(true); payAction = null; }
    });
    payCancelEl.addEventListener('click', function () {
        payMask.classList.remove('show');
        if (payAction) { payAction(false); payAction = null; }
    });
    payMask.addEventListener('click', function (e) {
        if (e.target === payMask) { payMask.classList.remove('show'); payAction = null; }
    });

    function handlePayCard(card) {
        if (card.classList.contains('done')) { return; }
        var type = card.getAttribute('data-type');
        var amount = card.getAttribute('data-amount');
        var wrap = card.parentNode;
        /* 收款/退款的那条气泡出现在付款方的对面：左侧来的转账 → 右侧「已收款」 */
        var msgEl = card.closest ? card.closest('.msg') : null;
        var receiver = msgEl && msgEl.classList.contains('other') ? 'me' : 'other';

        if (type === 'transfer') {
            openPay('收到一笔 ¥' + fmtMoney(amount) + ' 的转账', '', '退还转账', '确认收款', function (ok) {
                if (ok) {
                    wrap.innerHTML = transferDoneHtml(amount, '已被接收');
                    appendMsgNode(receiver, '<div class="pay-wrap">' +
                                  transferDoneHtml(amount, '已收款') + '</div>');
                    toast('已收款');
                    saveChatMessages(true);
                } else {
                    wrap.innerHTML = transferDoneHtml(amount, '已被退还');
                    appendMsgNode(receiver, '<div class="pay-wrap">' +
                                  transferDoneHtml(amount, '已退还') + '</div>');
                    toast('已退还');
                    saveChatMessages(true);
                }
            });
        } else if (type === 'redpacket') {
            openPay('微信红包', '恭喜发财，大吉大利', '取消', '开', function (ok) {
                if (!ok) { return; }
                var got = (Math.random() * 8 + 0.5).toFixed(2);
                wrap.innerHTML = redPacketDoneHtml(got);
                toast('红包已存入零钱');
                saveChatMessages(true);
            });
        }
    }

    document.getElementById('btnRedPacket').addEventListener('click', function () {
        hideChatPanels();
        appendMsgNode(sendAs, '<div class="pay-wrap">' + redPacketHtml() + '</div>');
    });

    /* 添加时间：在聊天流里插入一条时间分隔 */
    function insertChatTime() {
        var d = new Date();
        var hh = d.getHours();
        var mm = d.getMinutes();
        var row = document.createElement('div');
        row.className = 'chat-time';
        row.textContent = (hh < 10 ? '0' + hh : '' + hh) + ':' + (mm < 10 ? '0' + mm : '' + mm);
        msgList.appendChild(row);
        scrollBottom();
        saveChatMessages();
        toast('已添加聊天时间');
    }

    document.getElementById('btnAddTime').addEventListener('click', function () {
        insertChatTime();
        hideChatPanels();
    });

    Array.prototype.forEach.call(plusPanel.querySelectorAll('.plus-item[data-demo]'), function (btn) {
        btn.addEventListener('click', function () {
            toast(btn.getAttribute('data-demo') + ' · 演示版暂未展开');
        });
    });

    document.getElementById('btnTransfer').addEventListener('click', function () {
        hideChatPanels();
        moneyInput.value = '';
        moneyMask.classList.add('show');
        setTimeout(function () { moneyInput.focus(); }, 60);
    });

    document.getElementById('moneyCancel').addEventListener('click', function () {
        moneyMask.classList.remove('show');
    });
    document.getElementById('moneyOk').addEventListener('click', function () {
        var v = moneyInput.value.trim();
        if (!/^\d+(\.\d{1,2})?$/.test(v) || Number(v) <= 0) {
            toast('请输入正确的金额');
            return;
        }
        var amount = Number(v).toFixed(2);
        moneyMask.classList.remove('show');
        appendMsgNode(sendAs, '<div class="pay-wrap">' +
            transferHtml(amount, sendAs === 'me' ? '你发起了一笔转账' : '对方发起了一笔转账') + '</div>');
    });
    moneyInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); document.getElementById('moneyOk').click(); }
    });
    moneyMask.addEventListener('click', function (e) {
        if (e.target === moneyMask) { moneyMask.classList.remove('show'); }
    });

    /* ---- 右上角 ＋ 号菜单 ---- */
    var navAdd = document.querySelector('#page-chats .nav-add');
    navAdd.addEventListener('click', function (e) {
        e.stopPropagation();
        var r = navAdd.getBoundingClientRect();
        plusMenu.style.top = (r.bottom + 6) + 'px';
        plusMenu.classList.toggle('show');
    });
    /* ---- 添加单聊 / 添加群聊 / 清空列表 / 退出模拟器 ---- */
    var chatList = document.querySelector('#page-chats .list');
    var addTitleEl = document.getElementById('addTitle');
    var addAvEl = document.getElementById('addAv');
    var addNameValEl = document.getElementById('addNameVal');
    var addAvatarLabel = document.querySelector('#addRowAvatar .add-name');
    var addNameLabel = document.querySelector('#addRowName .add-name');
    var addContentValEl = document.getElementById('addContentVal');
    var addNameMask = document.getElementById('addNameMask');
    var addNameTitleEl = document.getElementById('addNameTitle');
    var addNameInput = document.getElementById('addNameInput');
    var addAvatarInput = document.getElementById('addAvatarInput');
    var askMask = document.getElementById('askMask');
    var askTitleEl = document.getElementById('askTitle');
    var askTextEl = document.getElementById('askText');
    var exitLayer = document.getElementById('exitLayer');

    var ADD_KEY = 'wechat_custom_chats_v1';
    var addMode = 'single';
    var addAvatar = '';
    var addName = '';
    var addContent = '';
    var addNameTarget = 'name';
    var askAction = null;
    var customLoaded = false;

    function makeAv(kind) {
        var bg = '<rect width="60" height="60" fill="#E9E9E9"/>';
        if (kind === 'group') {
            var dots = '';
            for (var r = 0; r < 3; r++) {
                for (var c = 0; c < 3; c++) {
                    dots += '<circle cx="' + (17 + c * 13) + '" cy="' + (17 + r * 13) +
                            '" r="5.6" fill="#FAFAFA"/>';
                }
            }
            return '<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">' + bg + dots + '</svg>';
        }
        return '<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">' + bg +
               '<circle cx="30" cy="21" r="13" fill="#FAFAFA"/>' +
               '<rect x="25.6" y="30" width="8.8" height="12" fill="#FAFAFA"/>' +
               '<path d="M4 60c0-12.2 11-20 26-20s26 7.8 26 20z" fill="#FAFAFA"/>' +
               '</svg>';
    }

    function readCustom() {
        try { return JSON.parse(localStorage.getItem(ADD_KEY) || '[]') || []; }
        catch (e) { return []; }
    }
    function writeCustom(arr) {
        try { localStorage.setItem(ADD_KEY, JSON.stringify(arr)); } catch (e) {}
    }

    function makeRow(item) {
        var row = document.createElement('div');
        row.className = 'row';
        row.setAttribute('data-custom', '1');
        row.innerHTML =
            '<div class="avatar-wrap"><div class="avatar">' +
                (item.avatar ? '<img src="' + item.avatar + '" alt="">'
                             : makeAv(item.group ? 'group' : 'single')) +
            '</div></div>' +
            '<div class="row-body">' +
                '<div class="row-top">' +
                    '<div class="row-name"><span class="txt"></span></div>' +
                    '<div class="row-time">刚刚</div>' +
                '</div>' +
                '<div class="row-msg"></div>' +
            '</div>';
        row.querySelector('.row-name .txt').textContent = item.name;
        row.querySelector('.row-msg').textContent = item.group ? '群聊已创建' : '';
        return row;
    }

    function renderCustom() {
        if (customLoaded) { return; }
        customLoaded = true;
        var arr = readCustom();
        for (var i = arr.length - 1; i >= 0; i--) {
            chatList.insertBefore(makeRow(arr[i]), chatList.firstChild);
        }
    }

    /* 以前添加的单聊只有列表头像，补登记成“对方头像”，进聊天后显示在左侧 */
    function migrateCustomAvatars() {
        var arr = readCustom();
        var changed = false;
        for (var i = 0; i < arr.length; i++) {
            var item = arr[i];
            if (item.group || !item.avatar) { continue; }
            if (!avatarStore[item.name]) { avatarStore[item.name] = {}; }
            if (!avatarStore[item.name].other) {
                avatarStore[item.name].other = item.avatar;
                changed = true;
            }
        }
        if (changed) { saveAvatars(); }
    }

    function openAdd(mode) {
        var isGroup = mode === 'group';
        addMode = mode;
        addAvatar = '';
        addName = '';
        addContent = '';
        addNameTarget = 'name';
        addTitleEl.textContent = isGroup ? '添加群聊' : '添加对话';
        addAvatarLabel.textContent = isGroup ? '群头像' : '头像';
        addNameLabel.textContent = isGroup ? '群名称' : '昵称';
        addNameValEl.textContent = isGroup ? '输入群名称' : '输入昵称';
        addNameValEl.classList.remove('filled');
        addContentValEl.textContent = '输入内容';
        addContentValEl.classList.remove('filled');
        addAvEl.innerHTML = makeAv(isGroup ? 'group' : 'single');
        enterSub();
        showPage('page-addchat', true);
    }

    function showAsk(title, text, fn) {
        askTitleEl.textContent = title;
        askTextEl.textContent = text;
        askAction = fn;
        askMask.classList.add('show');
    }

    Array.prototype.forEach.call(plusMenu.querySelectorAll('button'), function (b) {
        b.addEventListener('click', function () {
            hidePlus();
            var act = b.getAttribute('data-act');
            if (act === 'add-one') {
                openAdd('single');
            } else if (act === 'add-group') {
                openAdd('group');
            } else if (act === 'clear') {
                showAsk('清空聊天列表', '所有会话都会从列表里移除，刷新页面可恢复示例会话。', function () {
                    Array.prototype.forEach.call(chatList.querySelectorAll('.row'), function (r) {
                        r.parentNode.removeChild(r);
                    });
                    writeCustom([]);
                    toast('聊天列表已清空');
                });
            } else if (act === 'exit') {
                exitLayer.classList.add('show');
            }
        });
    });

    document.getElementById('addBack').addEventListener('click', goBack);

    /* 头像：相册选图，压缩后显示在方框里 */
    document.getElementById('addRowAvatar').addEventListener('click', function () {
        addAvatarInput.click();
    });

    addAvatarInput.addEventListener('change', function () {
        var f = addAvatarInput.files && addAvatarInput.files[0];
        addAvatarInput.value = '';
        if (!f) { return; }
        if (!/^image\//.test(f.type)) { toast('请选择图片文件'); return; }

        var reader = new FileReader();
        reader.onload = function () {
            openCropper(reader.result, function (src) {
                addAvatar = src;
                addAvEl.innerHTML = '<img src="' + addAvatar + '" alt="">';
            });
        };
        reader.readAsDataURL(f);
    });

    /* 昵称 / 群名称 */
    document.getElementById('addRowName').addEventListener('click', function () {
        addNameTarget = 'name';
        addNameTitleEl.textContent = addMode === 'group' ? '输入群名称' : '输入昵称';
        addNameInput.value = addName;
        addNameMask.classList.add('show');
        setTimeout(function () { addNameInput.focus(); addNameInput.select(); }, 60);
    });

    /* 内容：进聊天后作为对方（左侧）的第一条消息 */
    document.getElementById('addRowContent').addEventListener('click', function () {
        addNameTarget = 'content';
        addNameTitleEl.textContent = '输入内容';
        addNameInput.value = addContent;
        addNameMask.classList.add('show');
        setTimeout(function () { addNameInput.focus(); addNameInput.select(); }, 60);
    });

    function closeAddName() { addNameMask.classList.remove('show'); }

    document.getElementById('addNameCancel').addEventListener('click', closeAddName);

    document.getElementById('addNameOk').addEventListener('click', function () {
        var v = addNameInput.value.trim();
        if (addNameTarget === 'content') {
            if (v.length > 60) { toast('内容最多 60 个字'); return; }
            addContent = v;
            addContentValEl.textContent = v || '输入内容';
            addContentValEl.classList.toggle('filled', !!v);
            closeAddName();
            return;
        }
        if (!v) { toast(addMode === 'group' ? '请输入群名称' : '请输入昵称'); return; }
        if (v.length > 16) { toast('最多 16 个字'); return; }
        addName = v;
        addNameValEl.textContent = v;
        addNameValEl.classList.add('filled');
        closeAddName();
    });

    addNameInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('addNameOk').click();
        }
    });

    addNameMask.addEventListener('click', function (e) {
        if (e.target === addNameMask) { closeAddName(); }
    });

    /* 确定：写入列表并进入聊天 */
    document.getElementById('addConfirm').addEventListener('click', function () {
        if (!addName) {
            toast(addMode === 'group' ? '请输入群名称' : '请输入昵称');
            return;
        }
        var item = { name: addName, avatar: addAvatar, group: addMode === 'group' };
        if (addContent) { item.content = addContent; }
        /* 添加单聊时选的头像属于对方，进聊天后显示在左侧 */
        if (!item.group && addAvatar) {
            if (!avatarStore[item.name]) { avatarStore[item.name] = {}; }
            avatarStore[item.name].other = addAvatar;
            saveAvatars();
        }
        var arr = readCustom();
        arr.push(item);
        writeCustom(arr);
        chatList.insertBefore(makeRow(item), chatList.firstChild);
        backToTabs();
        openChat(item.name, true);
    });

    /* 新添加的会话 → 聊天页（空会话） */
    chatList.addEventListener('click', function (e) {
        var row = e.target.closest && e.target.closest('.row[data-custom]');
        if (!row) { return; }
        var n = row.querySelector('.row-name');
        openChat(n ? n.textContent.trim() : '', true);
    });

    /* 确认弹框 */
    document.getElementById('askCancel').addEventListener('click', function () {
        askMask.classList.remove('show');
    });
    document.getElementById('askOk').addEventListener('click', function () {
        askMask.classList.remove('show');
        if (typeof askAction === 'function') { askAction(); }
    });
    askMask.addEventListener('click', function (e) {
        if (e.target === askMask) { askMask.classList.remove('show'); }
    });

    /* 退出模拟器 → 重新进入 */
    document.getElementById('exitBack').addEventListener('click', function () {
        exitLayer.classList.remove('show');
        showPage('page-chats', false);
        Array.prototype.forEach.call(tabs, function (t) {
            t.classList.toggle('active', t.getAttribute('data-page') === 'page-chats');
        });
    });

    renderCustom();
    migrateCustomAvatars();
    applyListPreviews();

    document.addEventListener('click', function (e) {
        var t = e.target;
        var inMenu = t.closest && t.closest('#bubMenu');
        var inBub = t.closest && (t.closest('.bub') || t.closest('.chat-time') || t.closest('.pay-card'));
        if (!inMenu && !inBub) hideBubMenu();
        var inPlus = t.closest && t.closest('#plusMenu');
        var inAdd = t.closest && t.closest('.nav-add');
        if (!inPlus && !inAdd) hidePlus();
    });

    /* ==========================================================
       头像裁剪：所有「改头像」入口共用
       ========================================================== */
    var cropMask = document.getElementById('cropMask');
    var cropStage = document.getElementById('cropStage');
    var cropImg = document.getElementById('cropImg');
    var cropZoom = document.getElementById('cropZoom');
    var cropState = null;

    function cropApply() {
        var st = cropState;
        if (!st) { return; }
        var w = st.baseW * st.zoom;
        var h = st.baseH * st.zoom;
        if (w <= st.S) { st.x = (st.S - w) / 2; }
        else { st.x = Math.min(0, Math.max(st.S - w, st.x)); }
        if (h <= st.S) { st.y = (st.S - h) / 2; }
        else { st.y = Math.min(0, Math.max(st.S - h, st.y)); }
        cropImg.style.width = w + 'px';
        cropImg.style.height = h + 'px';
        cropImg.style.left = st.x + 'px';
        cropImg.style.top = st.y + 'px';
    }

    function cropSetZoom(z) {
        var st = cropState;
        if (!st) { return; }
        z = Math.max(1, Math.min(3, z));
        var cx = st.S / 2;
        var cy = st.S / 2;
        var ow = st.baseW * st.zoom;
        var oh = st.baseH * st.zoom;
        var rx = (cx - st.x) / ow;
        var ry = (cy - st.y) / oh;
        st.zoom = z;
        var nw = st.baseW * z;
        var nh = st.baseH * z;
        st.x = cx - rx * nw;
        st.y = cy - ry * nh;
        cropApply();
    }

    function openCropper(src, cb) {
        var S = Math.round(Math.min(window.innerWidth - 56, 300));
        S = Math.max(180, S);
        cropStage.style.width = S + 'px';
        cropStage.style.height = S + 'px';
        cropState = { S: S, zoom: 1, x: 0, y: 0, baseW: 0, baseH: 0, cb: cb, drag: null };
        cropZoom.value = 1;
        cropImg.style.width = '0px';
        cropImg.style.height = '0px';
        cropImg.onload = function () {
            var nw = cropImg.naturalWidth || cropImg.width;
            var nh = cropImg.naturalHeight || cropImg.height;
            if (!nw || !nh) { toast('图片读取失败'); return; }
            var k = Math.max(S / nw, S / nh);
            cropState.baseW = nw * k;
            cropState.baseH = nh * k;
            cropState.zoom = 1;
            cropState.x = (S - cropState.baseW) / 2;
            cropState.y = (S - cropState.baseH) / 2;
            cropApply();
            cropMask.classList.add('show');
        };
        cropImg.onerror = function () { toast('图片读取失败'); };
        cropImg.src = src;
    }
    window.openCropper = openCropper;

    cropZoom.addEventListener('input', function () {
        cropSetZoom(parseFloat(cropZoom.value) || 1);
    });

    cropStage.addEventListener('pointerdown', function (e) {
        if (!cropState) { return; }
        cropState.drag = { px: e.clientX, py: e.clientY, x: cropState.x, y: cropState.y };
        try { cropStage.setPointerCapture(e.pointerId); } catch (err) {}
    });
    cropStage.addEventListener('pointermove', function (e) {
        var st = cropState;
        if (!st || !st.drag) { return; }
        st.x = st.drag.x + (e.clientX - st.drag.px);
        st.y = st.drag.y + (e.clientY - st.drag.py);
        cropApply();
    });
    function cropEndDrag() { if (cropState) { cropState.drag = null; } }
    cropStage.addEventListener('pointerup', cropEndDrag);
    cropStage.addEventListener('pointercancel', cropEndDrag);
    cropStage.addEventListener('wheel', function (e) {
        if (!cropState) { return; }
        e.preventDefault();
        cropSetZoom(cropState.zoom - e.deltaY * 0.0016);
        cropZoom.value = cropState.zoom;
    }, { passive: false });

    document.getElementById('cropCancel').addEventListener('click', function () {
        cropState = null;
        cropMask.classList.remove('show');
    });

    document.getElementById('cropOk').addEventListener('click', function () {
        var st = cropState;
        if (!st || !st.baseW) { return; }
        var OUT = 240;
        var r = OUT / st.S;
        var cv = document.createElement('canvas');
        cv.width = OUT;
        cv.height = OUT;
        var ctx = cv.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, OUT, OUT);
        ctx.drawImage(cropImg, st.x * r, st.y * r,
            st.baseW * st.zoom * r, st.baseH * st.zoom * r);
        var out = cv.toDataURL('image/jpeg', 0.88);
        var cb = st.cb;
        cropState = null;
        cropMask.classList.remove('show');
        if (typeof cb === 'function') { cb(out); }
    });

    /* ==========================================================
       会话列表：从右往左滑出「删除」
       ========================================================== */
    var swipeState = null;

    function rowParts(row) {
        var arr = [];
        Array.prototype.forEach.call(row.children, function (el) {
            if (!el.classList.contains('row-del')) { arr.push(el); }
        });
        return arr;
    }

    function shiftRow(row, dx, animate) {
        Array.prototype.forEach.call(rowParts(row), function (el) {
            el.style.transition = animate ? 'transform .22s ease' : 'none';
            el.style.transform = dx ? 'translateX(' + dx + 'px)' : '';
        });
    }

    function ensureRowDel(row) {
        if (row.querySelector('.row-del')) { return; }
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'row-del';
        btn.textContent = '删除';
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            deleteChatRow(row);
        });
        row.appendChild(btn);
    }

    function closeSwipes(except) {
        Array.prototype.forEach.call(chatList.querySelectorAll('.row.swiped'), function (r) {
            if (r === except) { return; }
            r.classList.remove('swiped');
            shiftRow(r, 0, true);
        });
    }

    function deleteChatRow(row) {
        var nameEl = row.querySelector('.row-name .txt') || row.querySelector('.row-name');
        var name = nameEl ? nameEl.textContent.trim() : '';
        if (row.parentNode) { row.parentNode.removeChild(row); }
        if (name && chatMsgs[name]) {
            delete chatMsgs[name];
            writeMsgStore();
        }
        var arr = readCustom();
        var next = arr.filter(function (it) { return it.name !== name; });
        if (next.length !== arr.length) { writeCustom(next); }
        toast(name ? '已删除「' + name + '」' : '已删除');
    }

    function prepareSwipeRows() {
        Array.prototype.forEach.call(chatList.querySelectorAll('.row'), ensureRowDel);
    }

    chatList.addEventListener('touchstart', function (e) {
        var row = e.target.closest ? e.target.closest('.row') : null;
        if (!row || !e.touches[0]) { return; }
        closeSwipes(row);
        prepareSwipeRows();
        swipeState = {
            row: row,
            sx: e.touches[0].clientX,
            sy: e.touches[0].clientY,
            base: row.classList.contains('swiped') ? -76 : 0,
            dx: 0,
            lock: null
        };
    }, { passive: true });

    chatList.addEventListener('touchmove', function (e) {
        var st = swipeState;
        if (!st || !e.touches[0]) { return; }
        var dx = e.touches[0].clientX - st.sx;
        var dy = e.touches[0].clientY - st.sy;
        if (!st.lock) {
            if (Math.abs(dx) < 6 && Math.abs(dy) < 6) { return; }
            st.lock = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
            if (st.lock === 'x') {
                st.row.classList.add('swiping');
                ensureRowDel(st.row);
            }
        }
        if (st.lock !== 'x') { return; }
        e.preventDefault();
        var shift = st.base + dx;
        if (shift > 0) { shift = 0; }
        if (shift < -86) { shift = -86; }
        st.dx = shift;
        shiftRow(st.row, shift, false);
    }, { passive: false });

    function endSwipe() {
        var st = swipeState;
        if (!st) { return; }
        if (st.lock === 'x') {
            var open = st.dx < -38;
            st.row.classList.remove('swiping');
            st.row.classList.toggle('swiped', open);
            shiftRow(st.row, open ? -76 : 0, true);
        }
        swipeState = null;
    }
    chatList.addEventListener('touchend', endSwipe);
    chatList.addEventListener('touchcancel', endSwipe);

    /* 已滑开的行：点一下只收起，不进入会话 */
    chatList.addEventListener('click', function (e) {
        var row = e.target.closest ? e.target.closest('.row.swiped') : null;
        if (!row) { return; }
        if (e.target.closest('.row-del')) { return; }
        row.classList.remove('swiped');
        shiftRow(row, 0, true);
        e.stopPropagation();
        e.preventDefault();
    }, true);

    prepareSwipeRows();

    /* ---- 注册 Service Worker，让页面可离线 / 可添加到主屏幕 ---- */
    if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) {
        window.addEventListener('load', function () {
            navigator.serviceWorker.register('./sw.js').catch(function () {});
        });
    }
})();

/* ---------- 脚本块 3：个人信息页（头像/名字/微信号修改） ---------- */
/* 个人信息：点头像 / 名字 / 微信号 → 进入可修改的个人信息页
   数据存在 localStorage，刷新、关掉重开都还在 */
(function () {
    var sheet = document.getElementById('infoSheet');
    if (!sheet) return;

    var mask = document.getElementById('infoMask');
    var inputEl = document.getElementById('infoInput');
    var titleEl = document.getElementById('infoTitle');
    var fileEl = document.getElementById('avatarInput');
    var toastEl = document.getElementById('toast');
    var bodyEl = sheet.querySelector('.info-body');

    var meAvatar = document.getElementById('meAvatar');
    var nameEl = document.getElementById('meNameText');
    var idEl = document.getElementById('meIdText');
    var sheetAvatar = document.getElementById('infoAvatar');
    var sheetName = document.getElementById('infoNameVal');
    var sheetId = document.getElementById('infoIdVal');

    var KEY = 'wechat_me_profile_v1';
    var data = { name: '', wxid: '', avatar: '' };
    var field = 'name';
    var tTimer = null;

    function say(t) {
        if (!toastEl) { return; }
        toastEl.textContent = t;
        toastEl.classList.add('show');
        clearTimeout(tTimer);
        tTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1600);
    }

    function readStore() {
        var d = null;
        try { d = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { d = null; }
        var baseName = nameEl ? nameEl.textContent.trim() : '直接收米';
        var baseId = idEl ? idEl.textContent.replace(/^微信号：/, '').trim() : 'ask568988';
        data.name = (d && d.name) || baseName;
        data.wxid = (d && d.wxid) || baseId;
        data.avatar = (d && d.avatar) || '';
    }

    function writeStore() {
        try {
            localStorage.setItem(KEY, JSON.stringify(data));
            return true;
        } catch (e) {
            return false;
        }
    }

    function paintAvatar(el) {
        if (!el) { return; }
        if (data.avatar) {
            el.style.backgroundImage = 'url("' + data.avatar + '")';
            el.classList.add('has-photo');
        } else {
            el.style.backgroundImage = '';
            el.classList.remove('has-photo');
        }
    }

    function paint() {
        if (nameEl) { nameEl.textContent = data.name; }
        if (idEl) { idEl.textContent = '微信号：' + data.wxid; }
        if (sheetName) { sheetName.textContent = data.name; }
        if (sheetId) { sheetId.textContent = data.wxid; }
        paintAvatar(meAvatar);
        paintAvatar(sheetAvatar);
    }

    function openSheet() {
        sheet.classList.add('show');
        if (bodyEl) { bodyEl.scrollTop = 0; }
    }
    function closeSheet() { sheet.classList.remove('show'); }

    Array.prototype.forEach.call(document.querySelectorAll('.me-entry'), function (el) {
        el.addEventListener('click', openSheet);
    });
    document.getElementById('infoBack').addEventListener('click', closeSheet);

    /* ---- 头像：从相册选图，压缩后存本地 ---- */
    document.getElementById('rowAvatar').addEventListener('click', function () { fileEl.click(); });

    fileEl.addEventListener('change', function () {
        var f = fileEl.files && fileEl.files[0];
        fileEl.value = '';
        if (!f) { return; }
        if (!/^image\//.test(f.type)) { say('请选择图片文件'); return; }

        var reader = new FileReader();
        reader.onload = function () {
            if (typeof window.openCropper !== 'function') { say('裁剪组件未加载'); return; }
            window.openCropper(reader.result, function (src) {
                var old = data.avatar;
                data.avatar = src;
                if (!writeStore()) {
                    data.avatar = old;
                    say('存储空间不足，换张小图试试');
                    return;
                }
                paint();
                say('头像已更新');
            });
        };
        reader.readAsDataURL(f);
    });

    /* ---- 名字 / 微信号 ---- */
    function openEdit(f) {
        field = f;
        if (f === 'name') {
            titleEl.textContent = '修改名字';
            inputEl.value = data.name;
            inputEl.maxLength = 16;
        } else {
            titleEl.textContent = '修改微信号';
            inputEl.value = data.wxid;
            inputEl.maxLength = 20;
        }
        mask.classList.add('show');
        setTimeout(function () { inputEl.focus(); inputEl.select(); }, 60);
    }

    document.getElementById('rowName').addEventListener('click', function () { openEdit('name'); });
    document.getElementById('rowId').addEventListener('click', function () { openEdit('wxid'); });
    document.getElementById('rowQr').addEventListener('click', function () { say('我的二维码 · 演示版暂未展开'); });
    document.getElementById('rowMore').addEventListener('click', function () { say('更多信息 · 演示版暂未展开'); });

    document.getElementById('infoCancel').addEventListener('click', function () {
        mask.classList.remove('show');
    });

    document.getElementById('infoSave').addEventListener('click', function () {
        var v = inputEl.value.trim();
        if (field === 'name') {
            if (!v) { say('名字不能为空'); return; }
            if (v.length > 16) { say('名字最多 16 个字'); return; }
            data.name = v;
        } else {
            if (!/^[A-Za-z][A-Za-z0-9_-]{5,19}$/.test(v)) {
                say('微信号需 6-20 位、字母开头');
                return;
            }
            data.wxid = v;
        }
        if (!writeStore()) { say('保存失败，请清理浏览器存储'); return; }
        paint();
        mask.classList.remove('show');
        say('已保存');
    });

    inputEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('infoSave').click();
        }
    });

    mask.addEventListener('click', function (e) {
        if (e.target === mask) { mask.classList.remove('show'); }
    });

    readStore();
    paint();

    /* 供聊天页调用：改右侧头像时同步「我」页 */
    window.__setMeAvatar = function (src) {
        var old = data.avatar;
        data.avatar = src || '';
        if (!writeStore()) {
            data.avatar = old;
            return false;
        }
        paint();
        return true;
    };
})();
