// UwU 小手机 - 联机版 ST 扩展启动器

const UWU_URL = '/scripts/extensions/third-party/uwu-multiplayer/index.html';

function addUwUMultiplayerMenuButton() {
    const menu = document.getElementById('extensionsMenu');

    if (!menu) {
        setTimeout(addUwUMultiplayerMenuButton, 500);
        return;
    }

    // 和原版使用不同 ID，避免两个扩展互相冲突
    if (document.getElementById('uwu-multiplayer-wand-btn')) return;

    const container = document.createElement('div');
    container.className = 'extension_container interactable';

    container.innerHTML = `
        <div
            id="uwu-multiplayer-wand-btn"
            class="list-group-item flex-container flexGap5 interactable"
            title="UwU 小手机联机版 - 在新标签打开"
        >
            <div class="fa-fw fa-solid fa-mobile-screen-button extensionsMenuExtensionButton"></div>
            <span>UwU 小手机 · 联机版</span>
        </div>
    `;

    container.addEventListener('click', () => {
        window.open(UWU_URL, '_blank', 'noopener');
    });

    menu.appendChild(container);

    console.log('[UwU 小手机联机版] 入口按钮已注入');
}

addUwUMultiplayerMenuButton();
