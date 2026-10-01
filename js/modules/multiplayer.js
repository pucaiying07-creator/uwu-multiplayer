// UwU Multiplayer V2.2 - Local Character AI
// 功能：真人联机 + 各自本地角色 + 联机公开人设 + 各设备只生成自己拥有的角色。
// 隐私原则：完整角色卡、人设、世界书、私聊与 Tavern 记忆只留本地。
// 服务器只同步公开消息、公开身份与“群内公开人设”，不同步隐藏上下文。

(() => {
    'use strict';

    const SUPABASE_URL = 'https://thxyacngpdxzsydpgcrf.supabase.co';
    const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ZPuQaJKBAneBqVnyaEVfNg__E2jUqhQ';
    const STORAGE_KEY = 'uwu_multiplayer_session_v1';

    let client = null;
    let currentUser = null;
    let state = {
        roomId: null,
        roomCode: null,
        roomName: null,
        displayName: null,
        groupId: null,
        connected: false,
    };

    let channels = [];
    let scanTimer = null;
    let characterScanTimer = null;
    let syncingRemote = false;
    let characterSyncBusy = false;
    let localCharacterFingerprint = '';
    let aiSyncStartedAt = 0;

    const $ = (id) => document.getElementById(id);

    function toast(text) {
        if (typeof showToast === 'function') showToast(text);
        else console.log('[Multiplayer]', text);
    }

    function persistState() {
        if (state.roomId) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } else {
            localStorage.removeItem(STORAGE_KEY);
        }
    }

    function restoreState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;

            const saved = JSON.parse(raw);

            if (saved && saved.roomId && saved.groupId) {
                state = {
                    ...state,
                    ...saved,
                    connected: false,
                };
            }
        } catch (e) {
            console.warn('[Multiplayer] restore state failed', e);
        }
    }

    function injectStyles() {
        if ($('uwu-mp-style')) return;

        const style = document.createElement('style');
        style.id = 'uwu-mp-style';

        style.textContent = `
            #uwu-mp-fab{
                position:fixed;
                right:16px;
                bottom:92px;
                z-index:99990;
                border:0;
                border-radius:999px;
                padding:10px 14px;
                background:#111;
                color:#fff;
                font-size:13px;
                box-shadow:0 6px 20px rgba(0,0,0,.22);
            }

            #uwu-mp-fab.connected{
                background:#2f855a;
            }

            #uwu-mp-overlay{
                position:fixed;
                inset:0;
                z-index:99998;
                background:rgba(0,0,0,.42);
                display:none;
                align-items:center;
                justify-content:center;
                padding:18px;
                box-sizing:border-box;
            }

            #uwu-mp-overlay.visible{
                display:flex;
            }

            #uwu-mp-card{
                width:min(92vw,420px);
                max-height:82vh;
                overflow:auto;
                background:#fff;
                color:#222;
                border-radius:18px;
                padding:18px;
                box-shadow:0 16px 60px rgba(0,0,0,.3);
                font-family:inherit;
            }

            #uwu-mp-card h3{
                margin:0 0 12px;
                font-size:19px;
            }

            #uwu-mp-card label{
                display:block;
                font-size:12px;
                color:#666;
                margin:10px 0 5px;
            }

            #uwu-mp-card input{
                width:100%;
                box-sizing:border-box;
                padding:11px 12px;
                border:1px solid #ddd;
                border-radius:11px;
                font:inherit;
                background:#fff;
                color:#222;
            }

            #uwu-mp-card textarea{
                width:100%;
                min-height:92px;
                resize:vertical;
                box-sizing:border-box;
                padding:10px 11px;
                border:1px solid #ddd;
                border-radius:11px;
                font:inherit;
                line-height:1.5;
                background:#fff;
                color:#222;
            }

            .uwu-mp-profile-section{
                margin-top:14px;
                padding-top:12px;
                border-top:1px solid #eee;
            }

            .uwu-mp-profile-note{
                font-size:11px;
                line-height:1.5;
                color:#777;
                margin:5px 0 10px;
            }

            .uwu-mp-profile-card{
                border:1px solid #e8e8e8;
                border-radius:12px;
                padding:10px;
                margin-top:9px;
                background:#fafafa;
            }

            .uwu-mp-profile-name{
                font-size:13px;
                font-weight:700;
                margin-bottom:6px;
            }

            .uwu-mp-profile-save{
                width:100%;
                margin-top:8px;
            }

            .uwu-mp-row{
                display:flex;
                gap:8px;
                margin-top:12px;
            }

            .uwu-mp-btn{
                flex:1;
                border:0;
                border-radius:11px;
                padding:11px 12px;
                font:inherit;
                background:#111;
                color:#fff;
            }

            .uwu-mp-btn.secondary{
                background:#eee;
                color:#222;
            }

            .uwu-mp-btn.danger{
                background:#b83232;
                color:#fff;
            }

            #uwu-mp-status{
                margin-top:12px;
                padding:10px;
                border-radius:10px;
                background:#f5f5f5;
                font-size:12px;
                line-height:1.5;
                word-break:break-word;
            }

            #uwu-mp-connected{
                display:none;
                margin-top:12px;
                border-top:1px solid #eee;
                padding-top:12px;
            }

            #uwu-mp-connected.visible{
                display:block;
            }

            .uwu-mp-code{
                font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
                font-size:20px;
                font-weight:700;
                letter-spacing:2px;
            }
        `;

        document.head.appendChild(style);
    }

    function injectUI() {
        if ($('uwu-mp-fab')) return;

        const fab = document.createElement('button');
        fab.id = 'uwu-mp-fab';
        fab.type = 'button';
        fab.textContent = '联机';
        fab.addEventListener('click', openPanel);
        document.body.appendChild(fab);

        const overlay = document.createElement('div');
        overlay.id = 'uwu-mp-overlay';

        overlay.innerHTML = `
            <div id="uwu-mp-card">
                <h3>UwU 联机</h3>

                <label>你的昵称</label>
                <input
                    id="uwu-mp-name"
                    maxlength="24"
                    placeholder="例如：伶伶"
                >

                <label>创建房间时的房间名</label>
                <input
                    id="uwu-mp-room-name"
                    maxlength="40"
                    placeholder="例如：今晚一起聊天"
                >

                <div class="uwu-mp-row">
                    <button
                        class="uwu-mp-btn"
                        id="uwu-mp-create"
                        type="button"
                    >
                        创建房间
                    </button>
                </div>

                <label>加入朋友的房间</label>

                <input
                    id="uwu-mp-code"
                    maxlength="12"
                    placeholder="输入房间码"
                    autocapitalize="characters"
                >

                <div class="uwu-mp-row">
                    <button
                        class="uwu-mp-btn"
                        id="uwu-mp-join"
                        type="button"
                    >
                        加入房间
                    </button>
                </div>

                <div id="uwu-mp-connected">
                    <div>
                        当前房间：
                        <strong id="uwu-mp-current-room"></strong>
                    </div>

                    <div style="margin-top:6px">
                        房间码：
                        <span
                            class="uwu-mp-code"
                            id="uwu-mp-current-code"
                        ></span>
                    </div>

                    <div class="uwu-mp-row">
                        <button
                            class="uwu-mp-btn secondary"
                            id="uwu-mp-open-chat"
                            type="button"
                        >
                            打开聊天室
                        </button>

                        <button
                            class="uwu-mp-btn danger"
                            id="uwu-mp-disconnect"
                            type="button"
                        >
                            断开
                        </button>
                    </div>

                    <div class="uwu-mp-profile-section">
                        <strong style="font-size:13px">联机角色公开人设</strong>
                        <div class="uwu-mp-profile-note">
                            这里只写“给对方 AI 理解角色用”的公开设定。
                            你的角色本人生成时不会读取自己的这段内容；
                            完整角色卡、世界书、私聊和酒馆记忆仍只留在本机。
                        </div>
                        <div id="uwu-mp-character-profiles"></div>
                    </div>
                </div>

                <div id="uwu-mp-status">
                    正在初始化联机模块…
                </div>

                <div class="uwu-mp-row">
                    <button
                        class="uwu-mp-btn secondary"
                        id="uwu-mp-close"
                        type="button"
                    >
                        关闭
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        $('uwu-mp-close').addEventListener('click', closePanel);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closePanel();
            }
        });

        $('uwu-mp-create').addEventListener('click', createRoom);
        $('uwu-mp-join').addEventListener('click', joinRoom);
        $('uwu-mp-open-chat').addEventListener('click', openBoundGroup);
        $('uwu-mp-disconnect').addEventListener('click', disconnectRoom);

        updateUI();
    }

    function openPanel() {
        $('uwu-mp-overlay')?.classList.add('visible');

        if ($('uwu-mp-name') && state.displayName) {
            $('uwu-mp-name').value = state.displayName;
        }

        updateUI();
    }

    function closePanel() {
        $('uwu-mp-overlay')?.classList.remove('visible');
    }

    function setStatus(text, isError = false) {
        const el = $('uwu-mp-status');

        if (!el) return;

        el.textContent = text;
        el.style.background = isError ? '#fff0f0' : '#f5f5f5';
        el.style.color = isError ? '#a11' : '#333';
    }

    function updateUI() {
        const connected = !!state.roomId && state.connected;
        const fab = $('uwu-mp-fab');

        if (fab) {
            fab.classList.toggle('connected', connected);
            fab.textContent = connected
                ? `联机·${state.roomCode || ''}`
                : '联机';
        }

        $('uwu-mp-connected')?.classList.toggle(
            'visible',
            !!state.roomId
        );

        if ($('uwu-mp-current-room')) {
            $('uwu-mp-current-room').textContent =
                state.roomName || 'UwU 联机房间';
        }

        if ($('uwu-mp-current-code')) {
            $('uwu-mp-current-code').textContent =
                state.roomCode || '';
        }

        if (connected) {
            setStatus(
                '已连接。真人消息、角色公开身份与“联机公开人设”会同步；完整角色卡、世界书、私聊与 Tavern 记忆仍只保存在各自设备。'
            );
        }

        renderPublicProfileEditor();
    }

    async function waitForUwUReady(timeoutMs = 20000) {
        const started = Date.now();

        while (Date.now() - started < timeoutMs) {
            const hasDexie =
                typeof dexieDB !== 'undefined' &&
                dexieDB &&
                (!dexieDB.isOpen || dexieDB.isOpen());

            const loginOverlay =
                document.getElementById('login-overlay');

            if (
                hasDexie &&
                !loginOverlay &&
                typeof saveData === 'function' &&
                Array.isArray(db?.groups)
            ) {
                await new Promise((resolve) =>
                    setTimeout(resolve, 500)
                );

                return true;
            }

            await new Promise((resolve) =>
                setTimeout(resolve, 200)
            );
        }

        throw new Error(
            'UwU 本地数据还没有初始化，请先完成原版登录'
        );
    }

    async function ensureAuth() {
        if (!client) {
            throw new Error('Supabase 客户端未初始化');
        }

        const {
            data: { session },
            error
        } = await client.auth.getSession();

        if (error) throw error;

        if (session?.user) {
            currentUser = session.user;
            return currentUser;
        }

        const {
            data,
            error: signError
        } = await client.auth.signInAnonymously();

        if (signError) throw signError;

        currentUser =
            data.user ||
            data.session?.user;

        if (!currentUser) {
            throw new Error('匿名登录失败');
        }

        return currentUser;
    }

    function getDisplayName() {
        const value =
            $('uwu-mp-name')?.value?.trim();

        return (
            value ||
            state.displayName ||
            '玩家'
        );
    }

    async function createRoom() {
        try {
            setStatus('正在创建房间…');

            await ensureAuth();
            await waitForUwUReady();

            const displayName =
                getDisplayName();

            const roomName =
                $('uwu-mp-room-name')?.value?.trim() ||
                'UwU 联机房间';

            const {
                data,
                error
            } = await client.rpc(
                'create_multiplayer_room',
                {
                    p_name: roomName,
                    p_display_name: displayName,
                }
            );

            if (error) throw error;

            const row =
                Array.isArray(data)
                    ? data[0]
                    : data;

            if (!row?.room_id) {
                throw new Error(
                    '创建房间后没有返回 room_id'
                );
            }

            await bindRoom({
                roomId: row.room_id,
                roomCode: row.room_code,
                roomName: row.room_name,
                displayName,
            });

            toast(`房间已创建：${row.room_code}`);

            openBoundGroup();

        } catch (e) {
            console.error(
                '[Multiplayer] create room failed',
                e
            );

            setStatus(
                `创建失败：${e.message || e}`,
                true
            );
        }
    }

    async function joinRoom() {
        try {
            setStatus('正在加入房间…');

            await ensureAuth();
            await waitForUwUReady();

            const displayName =
                getDisplayName();

            const code =
                $('uwu-mp-code')
                    ?.value
                    ?.trim()
                    .toUpperCase();

            if (!code) {
                throw new Error('请输入房间码');
            }

            const {
                data,
                error
            } = await client.rpc(
                'join_multiplayer_room',
                {
                    p_room_code: code,
                    p_display_name: displayName,
                }
            );

            if (error) throw error;

            const row =
                Array.isArray(data)
                    ? data[0]
                    : data;

            if (!row?.room_id) {
                throw new Error(
                    '房间不存在或无法加入'
                );
            }

            await bindRoom({
                roomId: row.room_id,
                roomCode: row.room_code,
                roomName: row.room_name,
                displayName,
            });

            toast(`已加入房间：${row.room_code}`);

            openBoundGroup();

        } catch (e) {
            console.error(
                '[Multiplayer] join room failed',
                e
            );

            setStatus(
                `加入失败：${e.message || e}`,
                true
            );
        }
    }

    function makeGroup(room) {
        const groupId =
            `mp_${room.roomId}`;

        let group = db.groups.find(
            (g) =>
                g.id === groupId ||
                g.multiplayer?.roomId === room.roomId
        );

        if (!group) {
            group = {
                id: groupId,

                name:
                    room.roomName ||
                    'UwU 联机房间',

                avatar:
                    'https://i.postimg.cc/fTLCngk1/image.jpg',

                me: {
                    nickname:
                        room.displayName ||
                        '玩家',

                    persona: '',

                    avatar:
                        'https://i.postimg.cc/GtbTnxhP/o-o-1.jpg',

                    remoteUserId:
                        currentUser?.id ||
                        null,

                    isHuman: true,
                },

                members: [],

                theme: 'white_pink',

                maxMemory: 100,

                chatBg: '',

                history: [],

                isPinned: false,

                unreadCount: 0,

                useCustomBubbleCss: false,

                customBubbleCss: '',

                worldBookIds: [],

                allowGossip: false,

                privateSessions: {},

                multiplayer: {
                    enabled: true,
                    version: 2,
                    roomId: room.roomId,
                    roomCode: room.roomCode,
                    roomName: room.roomName,
                }
            };

            db.groups.push(group);

        } else {
            group.name =
                room.roomName ||
                group.name;

            group.me =
                group.me || {};

            group.me.nickname =
                room.displayName ||
                group.me.nickname ||
                '玩家';

            group.me.remoteUserId =
                currentUser?.id ||
                group.me.remoteUserId ||
                null;

            group.me.isHuman = true;

            group.multiplayer = {
                ...(group.multiplayer || {}),

                enabled: true,

                version: 2,

                roomId:
                    room.roomId,

                roomCode:
                    room.roomCode,

                roomName:
                    room.roomName,
            };
        }

        return group;
    }

    async function bindRoom(room) {
        await unsubscribeAll();

        const group =
            makeGroup(room);

        state = {
            ...state,
            ...room,
            groupId: group.id,
            connected: true,
        };

        persistState();

        await syncMembers();
        await syncCharacters({ pushLocal: true });
        await syncMessages();

        // 只同步本次联机会话中新生成的本机 AI 消息，
        // 避免升级/重连时把旧的本地群聊历史重新上传。
        aiSyncStartedAt = Date.now();

        await saveData();

        if (
            typeof renderChatList === 'function'
        ) {
            renderChatList();
        }

        subscribeRealtime();
        startLocalMessageScanner();
        updateUI();
    }

    async function resumeSavedRoom() {
        if (
            !state.roomId ||
            !state.groupId
        ) {
            return;
        }

        try {
            await ensureAuth();
            await waitForUwUReady();

            const {
                data: roomRows,
                error
            } = await client
                .from('rooms')
                .select(
                    'id,room_code,name'
                )
                .eq(
                    'id',
                    state.roomId
                )
                .limit(1);

            if (error) throw error;

            const room =
                roomRows?.[0];

            if (!room) {
                throw new Error(
                    '保存的房间已不可访问'
                );
            }

            await bindRoom({
                roomId:
                    room.id,

                roomCode:
                    room.room_code,

                roomName:
                    room.name,

                displayName:
                    state.displayName ||
                    '玩家',
            });

        } catch (e) {
            console.warn(
                '[Multiplayer] resume failed',
                e
            );

            state.connected = false;

            updateUI();

            setStatus(
                `未能恢复上次联机：${e.message || e}`,
                true
            );
        }
    }

    function openBoundGroup() {
        if (!state.groupId) return;

        const group = db.groups.find(
            (g) => g.id === state.groupId
        );

        if (!group) return;

        currentChatId = group.id;
        currentChatType = 'group';

        closePanel();

        if (typeof updateCustomBubbleStyle === 'function') {
            updateCustomBubbleStyle(
                currentChatId,
                group.customBubbleCss,
                group.useCustomBubbleCss
            );
        }

        if (typeof openChatRoom === 'function') {
            openChatRoom(currentChatId, currentChatType);
        }
    }

    function getBoundGroup() {
        return db.groups.find(
            (g) => g.id === state.groupId
        ) || null;
    }

    function getLocalCharacterMembers(group) {
        if (!group) return [];

        return (group.members || []).filter((member) => {
            if (
                member.isHuman ||
                member.isRemoteCharacter ||
                !member.originalCharId
            ) {
                return false;
            }

            return db.characters.some(
                (char) => char.id === member.originalCharId
            );
        });
    }

    function makeLocalCharacterFingerprint(group) {
        return JSON.stringify(
            getLocalCharacterMembers(group)
                .map((member) => ({
                    sourceId: String(member.originalCharId),
                    name:
                        member.groupNickname ||
                        member.realName ||
                        '',
                    avatar:
                        member.avatar ||
                        ''
                }))
                .sort((a, b) =>
                    a.sourceId.localeCompare(b.sourceId)
                )
        );
    }


    function renderPublicProfileEditor() {
        const root = $('uwu-mp-character-profiles');

        if (!root) return;

        root.innerHTML = '';

        if (
            !state.connected ||
            !state.roomId ||
            !state.groupId
        ) {
            return;
        }

        const group = getBoundGroup();
        const localMembers =
            getLocalCharacterMembers(group);

        if (!localMembers.length) {
            const empty =
                document.createElement('div');

            empty.className =
                'uwu-mp-profile-note';

            empty.textContent =
                '先在这个群的设置里添加你自己的本地角色，之后这里会出现对应的公开人设编辑框。';

            root.appendChild(empty);
            return;
        }

        for (const member of localMembers) {
            const card =
                document.createElement('div');

            card.className =
                'uwu-mp-profile-card';

            const name =
                document.createElement('div');

            name.className =
                'uwu-mp-profile-name';

            name.textContent =
                member.groupNickname ||
                member.realName ||
                '角色';

            const textarea =
                document.createElement('textarea');

            textarea.maxLength = 2000;
            textarea.placeholder =
                '例如：身份、公开性格、说话风格、外貌、与群友的公开关系。不要填秘密设定、世界书正文或私聊内容。';

            textarea.value =
                member.multiplayerPublicProfile ||
                '';

            const button =
                document.createElement('button');

            button.type = 'button';
            button.className =
                'uwu-mp-btn secondary uwu-mp-profile-save';

            button.textContent =
                '保存这名角色的公开人设';

            button.addEventListener(
                'click',
                async () => {
                    button.disabled = true;

                    const oldText =
                        button.textContent;

                    button.textContent =
                        '保存中…';

                    try {
                        await savePublicCharacterProfile(
                            String(
                                member.originalCharId
                            ),
                            textarea.value
                        );

                        button.textContent =
                            '已保存';

                        setTimeout(
                            () => {
                                button.textContent =
                                    oldText;
                                button.disabled =
                                    false;
                            },
                            900
                        );

                    } catch (e) {
                        console.error(
                            '[Multiplayer] save public profile failed',
                            e
                        );

                        button.textContent =
                            '保存失败';
                        button.disabled = false;

                        toast(
                            `公开人设保存失败：${e.message || e}`
                        );
                    }
                }
            );

            card.append(
                name,
                textarea,
                button
            );

            root.appendChild(card);
        }
    }

    async function savePublicCharacterProfile(
        sourceCharacterId,
        publicProfile
    ) {
        if (
            !state.roomId ||
            !currentUser?.id
        ) {
            throw new Error(
                '当前没有连接联机房间'
            );
        }

        const group = getBoundGroup();

        if (!group) {
            throw new Error(
                '没有找到当前联机群'
            );
        }

        const member =
            getLocalCharacterMembers(group)
                .find(
                    (item) =>
                        String(
                            item.originalCharId
                        ) ===
                        String(
                            sourceCharacterId
                        )
                );

        if (!member) {
            throw new Error(
                '这不是本机拥有的角色'
            );
        }

        const cleanProfile =
            String(publicProfile || '')
                .trim()
                .slice(0, 2000);

        member.multiplayerPublicProfile =
            cleanProfile;

        await saveData();

        // 用 upsert 保证刚拉进群、尚未完成第一次扫描的角色也能直接保存。
        const publicName =
            member.groupNickname ||
            member.realName ||
            '角色';

        const {
            data,
            error
        } = await client
            .from('room_characters')
            .upsert(
                {
                    room_id:
                        state.roomId,

                    source_character_id:
                        String(
                            member.originalCharId
                        ),

                    name:
                        publicName,

                    avatar_url:
                        member.avatar ||
                        null,

                    public_profile:
                        cleanProfile,

                    created_by:
                        currentUser.id,

                    enabled:
                        true,
                },
                {
                    onConflict:
                        'room_id,created_by,source_character_id'
                }
            )
            .select(
                'id,public_profile'
            )
            .single();

        if (error) throw error;

        member.multiplayerCharacterId =
            data?.id ||
            member.multiplayerCharacterId ||
            null;

        member.multiplayerPublicProfile =
            data?.public_profile ||
            cleanProfile;

        await saveData();

        // 对方通过 Realtime 会自动收到更新。
        renderPublicProfileEditor();
    }

    async function syncMembers() {
        if (!state.roomId) return;

        const {
            data,
            error
        } = await client
            .from('room_members')
            .select(
                'user_id,display_name,avatar_url,joined_at,last_seen'
            )
            .eq(
                'room_id',
                state.roomId
            );

        if (error) throw error;

        const group = getBoundGroup();

        if (!group) return;

        // 只替换“远程真人”，绝不覆盖本地角色或远程角色。
        const characterMembers =
            (group.members || []).filter(
                (member) => !member.isHuman
            );

        const remoteHumans =
            (data || [])
                .filter(
                    (member) =>
                        member.user_id !==
                        currentUser?.id
                )
                .map(
                    (member) => ({
                        id:
                            `human_${member.user_id}`,

                        remoteUserId:
                            member.user_id,

                        originalCharId:
                            null,

                        realName:
                            member.display_name ||
                            '玩家',

                        groupNickname:
                            member.display_name ||
                            '玩家',

                        persona:
                            '真人联机成员',

                        avatar:
                            member.avatar_url ||
                            'https://i.postimg.cc/Y96LPskq/o-o-2.jpg',

                        isHuman: true,
                        isRemoteHuman: true,
                    })
                );

        group.members = [
            ...characterMembers,
            ...remoteHumans,
        ];

        await saveData();

        if (
            typeof renderChatList === 'function'
        ) {
            renderChatList();
        }

        if (
            currentChatType === 'group' &&
            currentChatId === group.id &&
            typeof renderMessages === 'function'
        ) {
            renderMessages(false, true);
        }
    }

    async function syncOwnedCharacters(group) {
        if (
            !group ||
            !state.roomId ||
            !currentUser?.id
        ) {
            return;
        }

        const localMembers =
            getLocalCharacterMembers(group);

        const {
            data: ownedRows,
            error: readError
        } = await client
            .from('room_characters')
            .select(
                'id,source_character_id,name,avatar_url,public_profile,created_by'
            )
            .eq(
                'room_id',
                state.roomId
            )
            .eq(
                'created_by',
                currentUser.id
            );

        if (readError) throw readError;

        const localIds =
            new Set(
                localMembers.map(
                    (member) =>
                        String(member.originalCharId)
                )
            );

        // 角色从本地群里移除后，也从联机房间的公开角色列表移除。
        for (const row of ownedRows || []) {
            if (
                !localIds.has(
                    String(row.source_character_id)
                )
            ) {
                const {
                    error: deleteError
                } = await client
                    .from('room_characters')
                    .delete()
                    .eq(
                        'id',
                        row.id
                    );

                if (deleteError) {
                    throw deleteError;
                }
            }
        }

        // 只上传公开身份。私密字段由数据库默认值保持为空。
        for (
            let index = 0;
            index < localMembers.length;
            index += 1
        ) {
            const member =
                localMembers[index];

            const sourceId =
                String(member.originalCharId);

            const publicName =
                member.groupNickname ||
                member.realName ||
                '角色';

            const {
                data: upserted,
                error: upsertError
            } = await client
                .from('room_characters')
                .upsert(
                    {
                        room_id:
                            state.roomId,

                        source_character_id:
                            sourceId,

                        name:
                            publicName,

                        avatar_url:
                            member.avatar ||
                            null,

                        public_profile:
                            String(
                                member.multiplayerPublicProfile ||
                                ''
                            )
                                .trim()
                                .slice(0, 2000),

                        created_by:
                            currentUser.id,

                        enabled:
                            true,

                        sort_order:
                            index,
                    },
                    {
                        onConflict:
                            'room_id,created_by,source_character_id'
                    }
                )
                .select(
                    'id,source_character_id,name,avatar_url,public_profile,created_by'
                )
                .single();

            if (upsertError) {
                throw upsertError;
            }

            member.isLocalCharacter = true;
            member.isRemoteCharacter = false;
            member.multiplayerCharacterId =
                upserted?.id ||
                member.multiplayerCharacterId ||
                null;
            member.multiplayerOwnerId =
                currentUser.id;

            member.multiplayerPublicProfile =
                upserted?.public_profile ||
                member.multiplayerPublicProfile ||
                '';
        }

        renderPublicProfileEditor();
    }

    async function syncCharacters({
        pushLocal = false
    } = {}) {
        if (
            !state.roomId ||
            characterSyncBusy
        ) {
            return;
        }

        characterSyncBusy = true;

        try {
            const group = getBoundGroup();

            if (!group) return;

            if (pushLocal) {
                await syncOwnedCharacters(
                    group
                );
            }

            const {
                data,
                error
            } = await client
                .from('room_characters')
                .select(
                    'id,source_character_id,name,avatar_url,public_profile,created_by,enabled,sort_order'
                )
                .eq(
                    'room_id',
                    state.roomId
                )
                .eq(
                    'enabled',
                    true
                )
                .order(
                    'sort_order',
                    {
                        ascending: true
                    }
                );

            if (error) throw error;

            const ownedRows =
                new Map(
                    (data || [])
                        .filter(
                            (row) =>
                                row.created_by ===
                                currentUser?.id
                        )
                        .map(
                            (row) => [
                                String(
                                    row.source_character_id
                                ),
                                row
                            ]
                        )
                );

            // 给自己的本地角色补上服务器角色 ID。
            for (
                const member of
                getLocalCharacterMembers(group)
            ) {
                const row =
                    ownedRows.get(
                        String(
                            member.originalCharId
                        )
                    );

                if (row) {
                    member.isLocalCharacter = true;
                    member.isRemoteCharacter = false;
                    member.multiplayerCharacterId =
                        row.id;
                    member.multiplayerOwnerId =
                        currentUser.id;

                    member.multiplayerPublicProfile =
                        row.public_profile ||
                        member.multiplayerPublicProfile ||
                        '';
                }
            }

            const keepLocalAndHumans =
                (group.members || [])
                    .filter(
                        (member) =>
                            !member.isRemoteCharacter
                    );

            const remoteCharacters =
                (data || [])
                    .filter(
                        (row) =>
                            row.created_by !==
                            currentUser?.id
                    )
                    .map(
                        (row) => ({
                            id:
                                `remote_char_${row.id}`,

                            originalCharId:
                                null,

                            realName:
                                row.name ||
                                '远程角色',

                            groupNickname:
                                row.name ||
                                '远程角色',

                            persona:
                                '远程角色。其完整人设、世界书与私聊记忆只保存在拥有者设备上。',

                            avatar:
                                row.avatar_url ||
                                'https://i.postimg.cc/fTLCngk1/image.jpg',

                            isHuman:
                                false,

                            isRemoteCharacter:
                                true,

                            isLocalCharacter:
                                false,

                            remoteCharacterId:
                                row.id,

                            multiplayerCharacterId:
                                row.id,

                            remoteOwnerId:
                                row.created_by,

                            multiplayerOwnerId:
                                row.created_by,

                            // 只供“其他设备的 AI”读取。
                            // 不写入 persona，避免它变成原版角色卡的一部分。
                            multiplayerPublicProfile:
                                row.public_profile ||
                                '',
                        })
                    );

            group.members = [
                ...keepLocalAndHumans,
                ...remoteCharacters,
            ];

            localCharacterFingerprint =
                makeLocalCharacterFingerprint(
                    group
                );

            await saveData();
            renderPublicProfileEditor();

            if (
                typeof renderChatList ===
                'function'
            ) {
                renderChatList();
            }

            if (
                currentChatType === 'group' &&
                currentChatId === group.id
            ) {
                if (
                    typeof renderGroupMembersInSettings ===
                    'function'
                ) {
                    try {
                        renderGroupMembersInSettings(
                            group
                        );
                    } catch {}
                }

                if (
                    typeof renderMessages ===
                    'function'
                ) {
                    renderMessages(
                        false,
                        true
                    );
                }
            }
        } finally {
            characterSyncBusy = false;
        }
    }

    async function scanAndSyncLocalCharacters() {
        if (
            !state.connected ||
            !state.roomId ||
            !state.groupId
        ) {
            return;
        }

        const group = getBoundGroup();

        if (!group) return;

        const nextFingerprint =
            makeLocalCharacterFingerprint(
                group
            );

        if (
            nextFingerprint ===
            localCharacterFingerprint
        ) {
            return;
        }

        await syncCharacters({
            pushLocal: true
        });
    }

    async function syncMessages() {
        if (!state.roomId) return;

        const {
            data,
            error
        } = await client
            .from('messages')
            .select(
                'id,client_message_id,sender_kind,sender_user_id,character_id,sender_name,message_type,content,payload,created_at'
            )
            .eq(
                'room_id',
                state.roomId
            )
            .order(
                'created_at',
                {
                    ascending: true
                }
            )
            .limit(500);

        if (error) throw error;

        for (
            const row of data || []
        ) {
            await applyRemoteMessage(
                row,
                false
            );
        }

        await saveData();

        if (
            typeof renderChatList === 'function'
        ) {
            renderChatList();
        }

        if (
            currentChatType === 'group' &&
            currentChatId === state.groupId &&
            typeof renderMessages === 'function'
        ) {
            renderMessages(false, true);
        }
    }

    async function applyRemoteMessage(
        row,
        live = true
    ) {
        const group =
            db.groups.find(
                (g) =>
                    g.id === state.groupId
            );

        if (
            !group ||
            !row?.client_message_id
        ) {
            return;
        }

        if (
            group.history.some(
                (m) =>
                    m.id ===
                        row.client_message_id ||
                    m.multiplayerServerId ===
                        row.id
            )
        ) {
            return;
        }

        if (
            row.sender_kind !== 'human' &&
            row.sender_kind !== 'ai'
        ) {
            return;
        }

        const isMine =
            row.sender_user_id ===
            currentUser?.id;

        let senderId = null;

        if (row.sender_kind === 'human') {
            if (
                !isMine &&
                !group.members.some(
                    (m) =>
                        m.remoteUserId ===
                        row.sender_user_id
                )
            ) {
                await syncMembers();
            }

            senderId =
                isMine
                    ? 'user_me'
                    : `human_${row.sender_user_id}`;

        } else {
            let sender =
                (group.members || []).find(
                    (m) =>
                        m.multiplayerCharacterId ===
                        row.character_id ||
                        m.remoteCharacterId ===
                        row.character_id
                );

            if (!sender) {
                await syncCharacters({
                    pushLocal: false
                });

                sender =
                    (group.members || []).find(
                        (m) =>
                            m.multiplayerCharacterId ===
                            row.character_id ||
                            m.remoteCharacterId ===
                            row.character_id
                    );
            }

            if (!sender) {
                console.warn(
                    '[Multiplayer] AI message sender character not found',
                    row
                );

                return;
            }

            senderId = sender.id;
        }

        const message = {
            id:
                row.client_message_id,

            role:
                row.sender_kind === 'human' && isMine
                    ? 'user'
                    : 'assistant',

            content:
                row.content || '',

            parts: [
                {
                    type:
                        row.message_type ||
                        'text',

                    text:
                        row.content ||
                        ''
                }
            ],

            timestamp:
                row.created_at
                    ? new Date(
                        row.created_at
                    ).getTime()
                    : Date.now(),

            senderId,

            multiplayerServerId:
                row.id,

            multiplayerRemote:
                !isMine,

            multiplayerSynced:
                true,

            multiplayerSenderKind:
                row.sender_kind,

            multiplayerCharacterId:
                row.character_id ||
                null,

            quote:
                row.payload?.quote ||
                null,

            storyTime:
                row.payload?.storyTime ||
                null,
        };

        syncingRemote = true;

        try {
            group.history.push(
                message
            );

            if (
                live &&
                typeof addMessageBubble ===
                    'function'
            ) {
                addMessageBubble(
                    message,
                    group.id,
                    'group'
                );
            }

            await saveData();

            if (
                typeof renderChatList ===
                'function'
            ) {
                renderChatList();
            }

        } finally {
            syncingRemote = false;
        }
    }

    function subscribeRealtime() {
        if (!state.roomId) return;

        const msgChannel =
            client
                .channel(
                    `uwu-room-msg-${state.roomId}`
                )
                .on(
                    'postgres_changes',
                    {
                        event: 'INSERT',
                        schema: 'public',
                        table: 'messages',
                        filter:
                            `room_id=eq.${state.roomId}`
                    },
                    (payload) =>
                        applyRemoteMessage(
                            payload.new,
                            true
                        ).catch(
                            console.error
                        )
                )
                .subscribe(
                    (status) => {
                        if (
                            status ===
                            'SUBSCRIBED'
                        ) {
                            state.connected =
                                true;

                            persistState();
                            updateUI();
                        }
                    }
                );

        const memberChannel =
            client
                .channel(
                    `uwu-room-members-${state.roomId}`
                )
                .on(
                    'postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table:
                            'room_members',
                        filter:
                            `room_id=eq.${state.roomId}`
                    },
                    () =>
                        syncMembers().catch(
                            console.error
                        )
                )
                .subscribe();

        const characterChannel =
            client
                .channel(
                    `uwu-room-characters-${state.roomId}`
                )
                .on(
                    'postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table:
                            'room_characters',
                        filter:
                            `room_id=eq.${state.roomId}`
                    },
                    () =>
                        syncCharacters({
                            pushLocal: false
                        }).catch(
                            console.error
                        )
                )
                .subscribe();

        channels.push(
            msgChannel,
            memberChannel,
            characterChannel
        );
    }

    async function unsubscribeAll() {
        if (!client) return;

        for (
            const channel of channels
        ) {
            try {
                await client.removeChannel(
                    channel
                );
            } catch {}
        }

        channels = [];
    }

    function startLocalMessageScanner() {
        if (scanTimer) {
            clearInterval(scanTimer);
        }

        if (characterScanTimer) {
            clearInterval(
                characterScanTimer
            );
        }

        scanTimer =
            setInterval(
                () =>
                    scanAndPushLocalMessages()
                        .catch(
                            console.error
                        ),
                900
            );

        characterScanTimer =
            setInterval(
                () =>
                    scanAndSyncLocalCharacters()
                        .catch(
                            console.error
                        ),
                1200
            );
    }

    async function scanAndPushLocalMessages() {
        if (
            !state.connected ||
            !state.roomId ||
            !state.groupId ||
            syncingRemote
        ) {
            return;
        }

        const group =
            db.groups.find(
                (g) =>
                    g.id === state.groupId
            );

        if (
            !group?.history?.length
        ) {
            return;
        }

        // ---- 1. 真人消息 ----
        const humanCandidates =
            group.history.filter(
                (m) =>
                    m.role === 'user' &&
                    m.id &&
                    !m.multiplayerSynced &&
                    !m.multiplayerRemote &&
                    !m.fromTavern &&
                    m.role !== 'system'
            );

        for (
            const msg of humanCandidates
        ) {
            const {
                error
            } = await client
                .from('messages')
                .insert({
                    room_id:
                        state.roomId,

                    client_message_id:
                        msg.id,

                    sender_kind:
                        'human',

                    sender_user_id:
                        currentUser.id,

                    character_id:
                        null,

                    sender_name:
                        group.me?.nickname ||
                        state.displayName ||
                        '玩家',

                    message_type:
                        msg.parts?.[0]?.type ||
                        'text',

                    content:
                        msg.content ||
                        '',

                    payload: {
                        quote:
                            msg.quote ||
                            null,

                        storyTime:
                            msg.storyTime ||
                            null,
                    },
                });

            if (error) {
                if (
                    String(error.code) ===
                    '23505'
                ) {
                    msg.multiplayerSynced =
                        true;

                    continue;
                }

                console.error(
                    '[Multiplayer] push human message failed',
                    error
                );

                setStatus(
                    `真人消息同步失败：${error.message || error}`,
                    true
                );

                return;
            }

            msg.multiplayerSynced =
                true;

            await saveData();
        }

        // ---- 2. 本机拥有角色的 AI 消息 ----
        // 只同步本次联机会话开始后新生成的消息，避免把旧历史重新上传。
        const aiCandidates =
            group.history.filter(
                (m) => {
                    if (
                        m.role !== 'assistant' ||
                        !m.id ||
                        m.multiplayerSynced ||
                        m.multiplayerRemote ||
                        m.isThinking ||
                        m.isContextDisabled ||
                        m.role === 'system'
                    ) {
                        return false;
                    }

                    if (
                        aiSyncStartedAt &&
                        Number(m.timestamp || 0) <
                            aiSyncStartedAt - 1000
                    ) {
                        return false;
                    }

                    const sender =
                        (group.members || []).find(
                            member =>
                                member.id === m.senderId &&
                                member.isLocalCharacter &&
                                !member.isRemoteCharacter &&
                                member.multiplayerCharacterId
                        );

                    return Boolean(sender);
                }
            );

        for (const msg of aiCandidates) {
            const sender =
                (group.members || []).find(
                    member =>
                        member.id === msg.senderId &&
                        member.isLocalCharacter &&
                        !member.isRemoteCharacter &&
                        member.multiplayerCharacterId
                );

            if (!sender) continue;

            const {
                error
            } = await client
                .from('messages')
                .insert({
                    room_id:
                        state.roomId,

                    client_message_id:
                        msg.id,

                    sender_kind:
                        'ai',

                    sender_user_id:
                        currentUser.id,

                    character_id:
                        sender.multiplayerCharacterId,

                    sender_name:
                        sender.groupNickname ||
                        sender.realName ||
                        '角色',

                    message_type:
                        msg.parts?.[0]?.type ||
                        'text',

                    content:
                        msg.content ||
                        '',

                    payload: {
                        quote:
                            msg.quote ||
                            null,

                        storyTime:
                            msg.storyTime ||
                            null,
                    },
                });

            if (error) {
                if (
                    String(error.code) ===
                    '23505'
                ) {
                    msg.multiplayerSynced =
                        true;
                    continue;
                }

                console.error(
                    '[Multiplayer] push AI message failed',
                    error
                );

                setStatus(
                    `角色消息同步失败：${error.message || error}`,
                    true
                );

                return;
            }

            msg.multiplayerSynced =
                true;
            msg.multiplayerSenderKind =
                'ai';
            msg.multiplayerCharacterId =
                sender.multiplayerCharacterId;

            await saveData();
        }
    }

    async function disconnectRoom() {
        await unsubscribeAll();

        if (scanTimer) {
            clearInterval(
                scanTimer
            );
        }

        if (characterScanTimer) {
            clearInterval(
                characterScanTimer
            );
        }

        scanTimer = null;
        characterScanTimer = null;
        localCharacterFingerprint = '';
        aiSyncStartedAt = 0;

        state = {
            roomId: null,
            roomCode: null,
            roomName: null,
            displayName: null,
            groupId: null,
            connected: false
        };

        persistState();
        updateUI();

        setStatus(
            '已断开联机。本地聊天记录不会删除。'
        );
    }

    function blockAiForHumanOnlyRoom() {
        // V2.2 已接入“各设备只生成自己拥有角色”的手动 AI 回复链路。
        // 保留这个空函数只是为了兼容旧初始化代码，不再拦截 AI 按钮。
    }

    async function init() {
        injectStyles();
        injectUI();

        restoreState();
        updateUI();

        if (
            !window.supabase?.createClient
        ) {
            setStatus(
                'Supabase JS 没有加载成功，请检查网络。',
                true
            );

            return;
        }

        client =
            window.supabase.createClient(
                SUPABASE_URL,
                SUPABASE_PUBLISHABLE_KEY,
                {
                    auth: {
                        persistSession: true,
                        autoRefreshToken: true,
                        detectSessionInUrl: false
                    }
                }
            );

        try {
            await ensureAuth();

            setStatus(
                '联机服务已就绪。可以创建或加入房间。'
            );

            if (state.roomId) {
                await resumeSavedRoom();
            }

        } catch (e) {
            console.error(
                '[Multiplayer] init auth failed',
                e
            );

            setStatus(
                `联机初始化失败：${e.message || e}。请确认 Supabase 已开启 Anonymous Sign-Ins。`,
                true
            );
        }

        blockAiForHumanOnlyRoom();
    }

    window.MultiplayerSync = {
        get client() {
            return client;
        },

        get user() {
            return currentUser;
        },

        get state() {
            return {
                ...state
            };
        },

        open:
            openPanel,

        createRoom,

        joinRoom,

        disconnectRoom,

        syncMembers,

        syncMessages,

        syncCharacters,

        savePublicCharacterProfile,
    };

    if (
        document.readyState ===
        'loading'
    ) {
        document.addEventListener(
            'DOMContentLoaded',
            init
        );
    } else {
        setTimeout(
            init,
            0
        );
    }
})();
