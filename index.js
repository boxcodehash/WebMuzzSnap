// index.js

// ==========================================
// CONFIGURACIÓN (CONTRATO CORRECTO CONFIRMADO)
// ==========================================
const CONFIG = {
    // ✅ Dirección del contrato MUZZLE Token
    CONTRACT_ADDRESS: '0xef3dAa5fDa8Ad7aabFF4658f1F78061fd626B8f0',
    
    MIN_BALANCE: 40000000,
    
    // Chain ID: 1 = Ethereum Mainnet
    NETWORK_ID: 1,
    
    // 🎯 REDIRECCIÓN A LA NUEVA PÁGINA INFORMATIVA
    REDIRECT_URL: 'pagina_segura.html',
    REDIRECT_DELAY: 2000,
    
    // RPCs públicos de respaldo
    RPC_URLS: {
        1: 'https://eth.llamarpc.com',
        56: 'https://bsc-dataseed.binance.org',
        137: 'https://polygon-rpc.com',
        8453: 'https://mainnet.base.org'
    }
};

// Validar dirección del contrato al inicio
function validateContractAddress() {
    const addr = CONFIG.CONTRACT_ADDRESS;
    try {
        ethers.utils.getAddress(addr);
        if (addr.length !== 42) throw new Error('Length mismatch');
        return true;
    } catch (error) {
        console.error('❌ INVALID CONTRACT ADDRESS:', addr, error);
        
        messageTitle.textContent = "Configuration Error";
        noWalletText.innerHTML = `
            <strong>Invalid contract address!</strong><br><br>
            Current: <code class="text-xs">${addr || 'NOT SET'}</code><br>
            <small class="text-yellow-400">Please contact the administrator to fix the contract address in the configuration.</small>
        `;
        installMetaMaskButton.classList.add('hidden');
        noWalletMessage.classList.remove('hidden');
        updateStatus("Config error", 'error');
        return false;
    }
}

const ERC20_ABI = [
    "function balanceOf(address owner) view returns (uint256)",
    "function decimals() view returns (uint8)"
];

const LOGIN_MESSAGE = `Welcome to MuzzSnap

Contract: ${CONFIG.CONTRACT_ADDRESS}

Sign this message to authenticate securely.

This signature is gas-free.

Timestamp: ${Date.now()}`;

// ==========================================
// DETECCIÓN DE DISPOSITIVO Y PLATAFORMA
// ==========================================

function isMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function isIOS() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isAndroid() {
    return /Android/i.test(navigator.userAgent);
}

function isMetaMaskInstalled() {
    return typeof window.ethereum !== 'undefined' && window.ethereum.isMetaMask;
}

function getMetaMaskDeepLink() {
    const hostPath = `${window.location.host}${window.location.pathname}`;
    
    if (isAndroid() || isIOS()) {
        return `https://metamask.app.link/dapp/${hostPath}`;
    }
    return window.location.href;
}

function getMetaMaskInstallUrl() {
    if (isAndroid()) {
        return 'https://play.google.com/store/apps/details?id=io.metamask';
    } else if (isIOS()) {
        return 'https://apps.apple.com/app/metamask/id1438144202';
    }
    return 'https://metamask.io/download/';
}

// ==========================================
// REFERENCIAS DOM
// ==========================================
const logoButton = document.getElementById('logoButton');
const muzzLogo = document.getElementById('muzzLogo');
const loadingSpinner = document.getElementById('loadingSpinner');
const walletStatus = document.getElementById('walletStatus');
const noWalletMessage = document.getElementById('noWalletMessage');
const messageTitle = document.getElementById('messageTitle');
const noWalletText = document.getElementById('noWalletText');
const disconnectButton = document.getElementById('disconnectButton');
const balanceCard = document.getElementById('balanceCard');
const balanceAmount = document.getElementById('balanceAmount');
const userAddress = document.getElementById('userAddress');
const successMessage = document.getElementById('successMessage');
const installMetaMaskButton = document.getElementById('installMetaMaskButton');

let isConnecting = false;
let isConnected = false;
let currentAddress = null;
let currentSignature = null;

// ==========================================
// FUNCIONES AUXILIARES
// ==========================================

function updateStatus(msg, type = 'info') {
    walletStatus.textContent = msg;
    walletStatus.className = 'inline-block py-2 px-4 text-sm font-medium rounded-lg shadow-xl transition-colors duration-300';
    
    if (type === 'success') {
        walletStatus.classList.add('text-green-400', 'bg-green-900');
    } else if (type === 'error') {
        walletStatus.classList.add('text-red-400', 'bg-red-900');
    } else if (type === 'warning') {
        walletStatus.classList.add('text-yellow-400', 'bg-yellow-900');
    } else {
        walletStatus.classList.add('text-gray-400', 'bg-gray-800');
    }
}

function setLoading(loading) {
    isConnecting = loading;
    if (loading) {
        muzzLogo.style.opacity = '0.2';
        loadingSpinner.classList.remove('hidden');
        logoButton.style.cursor = 'wait';
    } else {
        muzzLogo.style.opacity = '1';
        loadingSpinner.classList.add('hidden');
        logoButton.style.cursor = 'pointer';
    }
}

function formatAddress(addr) {
    return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
}

async function checkBalance(address) {
    try {
        // 🛠️ MEJORA DE ROBUSTEZ: Validar y normalizar la dirección del usuario
        let validatedUserAddress;
        try {
            validatedUserAddress = ethers.utils.getAddress(address);
        } catch (e) {
            console.error('Validation Error on User Address:', e);
            throw new Error(`Wallet address received is invalid: ${address}. Please reconnect.`);
        }
        
        // 🛠️ MEJORA DE ROBUSTEZ: Validar y normalizar la dirección del contrato
        let validatedContractAddress;
        try {
            validatedContractAddress = ethers.utils.getAddress(CONFIG.CONTRACT_ADDRESS);
        } catch (e) {
             console.error('Validation Error on Contract Address:', e);
             throw new Error(`Configuration Error: Token contract address is invalid.`);
        }

        console.log('Checking balance for validated address:', validatedUserAddress);
        console.log('Contract address:', validatedContractAddress);
        
        let provider;
        try {
            provider = new ethers.providers.Web3Provider(window.ethereum);
        } catch (providerError) {
            console.error('Web3Provider error, falling back to JSON RPC:', providerError);
            provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URLS[CONFIG.NETWORK_ID] || 'https://eth.llamarpc.com');
        }
        
        const contract = new ethers.Contract(validatedContractAddress, ERC20_ABI, provider);
        
        console.log('Fetching balance...');
        const balance = await contract.balanceOf(validatedUserAddress); 
        console.log('Balance (raw):', balance.toString());
        
        console.log('Fetching decimals...');
        const decimals = await contract.decimals();
        console.log('Decimals:', decimals);
        
        const balanceFormatted = ethers.utils.formatUnits(balance, decimals);
        const balanceNumber = parseFloat(balanceFormatted);
        
        console.log('Balance formatted:', balanceNumber);
        
        return {
            balance: balance,
            raw: balanceNumber,
            formatted: balanceNumber.toLocaleString(undefined, {
                minimumFractionDigits: 0,
                maximumFractionDigits: 2
            }),
            hasAccess: balanceNumber >= CONFIG.MIN_BALANCE
        };
    } catch (error) {
        console.error('Error checking balance details:', {
            message: error.message,
            code: error.code,
            data: error.data,
            stack: error.stack
        });
        
        if (error.code === 'CALL_EXCEPTION') {
            throw new Error(`Invalid contract address or network (CALL_EXCEPTION). Please check configuration.`);
        } else if (error.code === 'NETWORK_ERROR' || error.message.includes('missing revert data')) {
            throw new Error(`Network connection failed or Contract not found on this network. Check you're on the correct chain (Ethereum Mainnet).`);
        } else {
            throw new Error(`Could not verify token balance: ${error.message}`);
        }
    }
}

async function checkNetwork() {
    try {
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        const currentChainId = parseInt(chainId, 16);
        
        if (currentChainId !== CONFIG.NETWORK_ID) {
            const networkNames = { 1: 'Ethereum Mainnet', 56: 'BSC Mainnet', 137: 'Polygon' };
            const currentNetwork = networkNames[currentChainId] || `Chain ID ${currentChainId}`;
            const expectedNetwork = networkNames[CONFIG.NETWORK_ID] || `Chain ID ${CONFIG.NETWORK_ID}`;
            
            throw new Error(`Wrong network! Connected to ${currentNetwork}, but need ${expectedNetwork}`);
        }
        return true;
    } catch (error) {
        throw error;
    }
}

// ==========================================
// FUNCIÓN PRINCIPAL
// ==========================================

async function connectWalletAndSign() {
    if (isConnecting || isConnected) return;

    if (!validateContractAddress()) return;

    const mobile = isMobile();
    const hasMetaMask = isMetaMaskInstalled();

    if (!hasMetaMask) {
        const installUrl = getMetaMaskInstallUrl();
        messageTitle.textContent = "MetaMask Not Detected";
        noWalletText.innerHTML = `Please install MetaMask. If you are on mobile, open this page inside the MetaMask app's browser.`;
        installMetaMaskButton.href = installUrl;
        installMetaMaskButton.classList.remove('hidden');
        noWalletMessage.classList.remove('hidden');
        updateStatus("MetaMask required", 'error');
        
        if (mobile) {
            const deepLink = getMetaMaskDeepLink();
            setTimeout(() => {
                window.location.href = deepLink;
            }, 500);
        }
        return;
    }

    try {
        setLoading(true);
        noWalletMessage.classList.add('hidden');
        balanceCard.classList.add('hidden');
        successMessage.classList.add('hidden');

        updateStatus("Connecting wallet...", 'info');
        
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        const address = accounts[0];
        currentAddress = address;

        updateStatus("Checking network...", 'info');
        await checkNetwork();

        updateStatus("Checking balance...", 'info');
        let balanceInfo = await checkBalance(address);
        
        balanceAmount.textContent = `${balanceInfo.formatted} MUZZLE`;
        userAddress.textContent = formatAddress(address);
        balanceCard.classList.remove('hidden');

        if (!balanceInfo.hasAccess) {
            updateStatus("Insufficient balance", 'error');
            messageTitle.textContent = "Access Denied";
            noWalletText.innerHTML = `You need at least <strong>${CONFIG.MIN_BALANCE.toLocaleString()}</strong> MUZZLE tokens.<br><br>Your balance: <strong>${balanceInfo.formatted}</strong> MUZZLE`;
            installMetaMaskButton.classList.add('hidden');
            noWalletMessage.classList.remove('hidden');
            setLoading(false);
            return;
        }

        updateStatus("Awaiting signature...", 'warning');
        
        const signature = await window.ethereum.request({
            method: 'personal_sign',
            params: [LOGIN_MESSAGE, address]
        });

        currentSignature = signature;

        isConnected = true;
        updateStatus("Authenticated!", 'success');
        successMessage.classList.remove('hidden');
        disconnectButton.classList.remove('hidden');

        const authData = { address, signature, timestamp: Date.now(), balance: balanceInfo.formatted };
        sessionStorage.setItem('muzzsnap_auth', JSON.stringify(authData));

        console.log(`Redirecting to ${CONFIG.REDIRECT_URL} in ${CONFIG.REDIRECT_DELAY}ms...`);
        
        setTimeout(() => {
            window.location.href = CONFIG.REDIRECT_URL;
        }, CONFIG.REDIRECT_DELAY);

    } catch (error) {
        console.error('Connection error:', error);
        isConnected = false;
        currentAddress = null;
        currentSignature = null;
        
        if (error.code === 4001) {
            updateStatus("Connection rejected", 'error');
            messageTitle.textContent = "Connection Cancelled";
            noWalletText.textContent = "You rejected the connection or signature request.";
        } else if (error.code === -32002) {
            updateStatus("Pending request", 'warning');
            messageTitle.textContent = "Request Pending";
            noWalletText.textContent = "Please check MetaMask for a pending request.";
        } else {
            updateStatus("Connection failed", 'error');
            messageTitle.textContent = "Connection Error";
            noWalletText.textContent = error.message || "An unexpected error occurred. Please try again.";
        }
        
        installMetaMaskButton.classList.add('hidden');
        noWalletMessage.classList.remove('hidden');
        
    } finally {
        setLoading(false);
    }
}

function disconnectWallet() {
    isConnected = false;
    currentAddress = null;
    currentSignature = null;
    
    updateStatus("Disconnected", 'info');
    disconnectButton.classList.add('hidden');
    balanceCard.classList.add('hidden');
    successMessage.classList.add('hidden');
    noWalletMessage.classList.add('hidden');
    
    sessionStorage.removeItem('muzzsnap_auth');
    
    console.log('Wallet disconnected');
}

// ==========================================
// EVENT LISTENERS
// ==========================================

logoButton.addEventListener('click', connectWalletAndSign);
disconnectButton.addEventListener('click', disconnectWallet);

if (window.ethereum) {
    window.ethereum.on('accountsChanged', (accounts) => {
        if (accounts.length === 0) {
            disconnectWallet();
        } else if (isConnected && accounts[0] !== currentAddress) {
            disconnectWallet();
            updateStatus("Account changed", 'warning');
        }
    });

    window.ethereum.on('chainChanged', (chainId) => {
        window.location.reload(); 
    });
}

// ==========================================
// INICIALIZACIÓN
// ==========================================

console.log('MuzzSnap Login initialized');

validateContractAddress();

installMetaMaskButton.href = getMetaMaskInstallUrl();

const savedAuth = sessionStorage.getItem('muzzsnap_auth');
if (savedAuth) {
    try {
        const authData = JSON.parse(savedAuth);
        const now = Date.now();
        if (now - authData.timestamp < 3600000) { 
            window.location.href = CONFIG.REDIRECT_URL;
        } else {
            sessionStorage.removeItem('muzzsnap_auth');
        }
    } catch (e) {
        console.error('Error loading session:', e);
        sessionStorage.removeItem('muzzsnap_auth');
    }
}
