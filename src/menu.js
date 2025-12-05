import './menu.css';
import { initMenuBackground } from './menu-background.js';

let gameLoaded = false;
let gameModule = null;
let backgroundScene = null;

function createMenu() {
    const menuContainer = document.createElement('div');
    menuContainer.id = 'menu-container';
    
    const backgroundContainer = document.createElement('div');
    backgroundContainer.id = 'menu-background-container';
    backgroundContainer.style.position = 'fixed';
    backgroundContainer.style.top = '0';
    backgroundContainer.style.left = '0';
    backgroundContainer.style.width = '100%';
    backgroundContainer.style.height = '100%';
    backgroundContainer.style.zIndex = '1';
    document.body.appendChild(backgroundContainer);
    
    backgroundScene = initMenuBackground(backgroundContainer);
    
    menuContainer.innerHTML = `
        <div class="menu-content">
            <div class="menu-title">
                <h1 class="title-main">FishWorld</h1>
                <p class="title-subtitle">Dive into the depths</p>
            </div>
            <div class="menu-buttons">
                <button id="start-btn" class="menu-btn menu-btn-primary">
                    <span class="btn-text">Start Game</span>
                    <span class="btn-icon">🐠</span>
                </button>
                <button id="quit-btn" class="menu-btn menu-btn-secondary">
                    <span class="btn-text">Quit</span>
                    <span class="btn-icon">🚪</span>
                </button>
            </div>
            <div class="menu-footer">
                <p>Use WASD to swim • Mouse to look • Space/Shift to ascend/descend</p>
            </div>
        </div>
    `;
    
    document.body.appendChild(menuContainer);
    
    const startBtn = document.getElementById('start-btn');
    const quitBtn = document.getElementById('quit-btn');
    
    startBtn.addEventListener('click', startGame);
    quitBtn.addEventListener('click', quitGame);
    
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !gameLoaded) {
            startGame();
        } else if (e.key === 'Escape' && !gameLoaded) {
            quitGame();
        }
    });
}

async function startGame() {
    if (gameLoaded) return;
    
    const menuContainer = document.getElementById('menu-container');
    const backgroundContainer = document.getElementById('menu-background-container');
    const startBtn = document.getElementById('start-btn');
    
    startBtn.disabled = true;
    startBtn.innerHTML = '<span class="btn-text">Loading...</span><span class="btn-icon">⏳</span>';
    
    try {
        menuContainer.style.opacity = '0';
        menuContainer.style.transition = 'opacity 1s ease-out';
        
        if (backgroundContainer) {
            backgroundContainer.style.opacity = '0';
            backgroundContainer.style.transition = 'opacity 1s ease-out';
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        if (backgroundScene && backgroundScene.dispose) {
            backgroundScene.dispose();
        }
        
        menuContainer.style.display = 'none';
        if (backgroundContainer) {
            backgroundContainer.style.display = 'none';
        }
        
        gameModule = await import('./water.js');
        gameLoaded = true;
        
        menuContainer.remove();
        if (backgroundContainer) {
            backgroundContainer.remove();
        }
        
    } catch (error) {
        console.error('Failed to load game:', error);
        startBtn.disabled = false;
        startBtn.innerHTML = '<span class="btn-text">Error - Click to retry</span><span class="btn-icon">⚠️</span>';
        menuContainer.style.opacity = '1';
        menuContainer.style.display = 'flex';
        if (backgroundContainer) {
            backgroundContainer.style.opacity = '1';
            backgroundContainer.style.display = 'block';
        }
    }
}

function quitGame() {
    if (confirm('Are you sure you want to quit?')) {
        window.close();
        if (window.history.length > 1) {
            window.history.back();
        } else {
            document.body.innerHTML = '<div style="display: flex; justify-content: center; align-items: center; height: 100vh; font-family: Arial, sans-serif; color: #fff; background: #0a1938;"><h1>Thanks for playing!</h1></div>';
        }
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createMenu);
} else {
    createMenu();
}

