/**
 * Shared MuzzID mint — same flow for login (index) + Social panel + muzzid.html
 * Requires: ethers v5 or v6, MUZZLE_CONFIG, optional MuzzID helpers
 */
(function (global) {
  'use strict';

  var ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
    'function allowance(address,address) view returns (uint256)',
    'function approve(address,uint256) returns (bool)',
  ];
  var MINTER_ABI = [
    'function costOfName(string) view returns (uint256)',
    'function mintUsername(string) returns (uint256)',
    'function isPremiumUsername(string) view returns (bool)',
    'function isValidUsername(string) view returns (bool)',
  ];
  var NFT_ABI = [
    'function primaryUsername(address) view returns (string)',
    'function exists(string) view returns (bool)',
  ];

  function cfg() {
    return global.MUZZLE_CONFIG || {};
  }

  function netDemo() {
    var c = cfg();
    var d = c.demo || {};
    return {
      key: 'demo',
      chainId: Number(d.chainId || 31337),
      rpcUrl: d.rpcUrl || 'http://127.0.0.1:8545',
      token: d.muzzleToken,
      minter: d.minter,
      nft: d.muzzleName,
      mock: true,
      label: 'Hardhat',
    };
  }

  function pickProvider() {
    var eth = global.ethereum;
    if (!eth) return null;
    if (eth.providers && eth.providers.length) {
      return (
        eth.providers.find(function (p) { return p.isMetaMask && !p.isBraveWallet; }) ||
        eth.providers.find(function (p) { return p.isMetaMask; }) ||
        eth.providers[0]
      );
    }
    return eth;
  }

  function isEthersV6() {
    return !!(global.ethers && global.ethers.BrowserProvider);
  }

  async function getWeb3(eth) {
    if (isEthersV6()) {
      var p6 = new ethers.BrowserProvider(eth);
      var s6 = await p6.getSigner();
      return { provider: p6, signer: s6, addr: await s6.getAddress() };
    }
    var p5 = new ethers.providers.Web3Provider(eth);
    var s5 = p5.getSigner();
    return { provider: p5, signer: s5, addr: await s5.getAddress() };
  }

  function maxUint() {
    if (isEthersV6()) return ethers.MaxUint256;
    return ethers.constants.MaxUint256;
  }

  function parseUnits(amount, decimals) {
    if (isEthersV6()) return ethers.parseUnits(String(amount), decimals);
    return ethers.utils.parseUnits(String(amount), decimals);
  }

  function formatUnits(v, decimals) {
    if (isEthersV6()) return ethers.formatUnits(v, decimals);
    return ethers.utils.formatUnits(v, decimals);
  }

  function lt(a, b) {
    if (typeof a.lt === 'function') return a.lt(b);
    return a < b;
  }

  async function pingHardhat() {
    var res = await fetch('http://127.0.0.1:8545', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    });
    var j = await res.json();
    if (j.result !== '0x7a69') throw new Error('Hardhat chainId mismatch');
  }

  async function ensureHardhat(eth) {
    await pingHardhat();
    var chainIdHex = '0x7a69';
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] });
    } catch (e) {
      if (e.code === 4902 || (e.data && e.data.originalError && e.data.originalError.code === 4902)) {
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: chainIdHex,
            chainName: 'Hardhat Local',
            rpcUrls: ['http://127.0.0.1:8545', 'http://localhost:8545'],
            nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
          }],
        });
      } else if (e.code === 4001) {
        throw new Error('Switch MetaMask to Hardhat Local (31337)');
      } else {
        throw e;
      }
    }
  }

  async function connectAndSign(onStatus) {
    var eth = pickProvider();
    if (!eth) throw new Error('Install / enable MetaMask');
    if (eth.isBraveWallet && !eth.isMetaMask) {
      throw new Error('Use MetaMask (brave://settings/wallet → Default = MetaMask)');
    }
    onStatus && onStatus('Open MetaMask…');
    try {
      await eth.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] });
    } catch (e) {
      if (e.code === 4001) throw e;
    }
    var accounts = await eth.request({ method: 'eth_requestAccounts' });
    if (!accounts || !accounts.length) throw new Error('No accounts');
    await ensureHardhat(eth);
    var w3 = await getWeb3(eth);
    var msg =
      'MuzzID Authentication\n\n' +
      'Sign to prove wallet ownership.\n' +
      'Address: ' + w3.addr + '\n' +
      'Network: Hardhat (31337)\n' +
      'Timestamp: ' + Date.now() + '\n\n' +
      'No gas / no MUZZ spent.';
    onStatus && onStatus('Sign message in MetaMask…');
    var sig = await w3.signer.signMessage(msg);
    var recovered = isEthersV6()
      ? ethers.verifyMessage(msg, sig)
      : ethers.utils.verifyMessage(msg, sig);
    if (String(recovered).toLowerCase() !== String(w3.addr).toLowerCase()) {
      throw new Error('Invalid signature');
    }
    try {
      sessionStorage.setItem('muzz_wallet_address', w3.addr);
      sessionStorage.setItem('muzz_login_method', 'wallet_signed');
      sessionStorage.setItem('muzz_auth', JSON.stringify({ address: w3.addr, signature: sig, at: Date.now() }));
    } catch (_) {}
    return { eth: eth, addr: w3.addr, signer: w3.signer, provider: w3.provider };
  }

  async function getBalance(signerOrProvider, tokenAddr, addr) {
    var token = new ethers.Contract(tokenAddr, ERC20_ABI, signerOrProvider);
    var bal = await token.balanceOf(addr);
    var dec = 18;
    try { dec = Number(await token.decimals()); } catch (_) {}
    var sym = 'MUZZ';
    try { sym = await token.symbol(); } catch (_) {}
    return { bal: bal, human: Number(formatUnits(bal, dec)), symbol: sym, decimals: dec, token: token };
  }

  async function mintUsername(username, opts) {
    opts = opts || {};
    var onStatus = opts.onStatus || function () {};
    username = String(username || '').trim();
    if (!username) throw new Error('Enter a username');
    if (username.length > 64) throw new Error('Username too long');

    var net = netDemo();
    if (!net.token || !net.minter || !net.nft) {
      throw new Error('Contracts missing. Run ARREGLAR-Y-ABRIR-MUZZID.bat');
    }

    var eth = pickProvider();
    if (!eth) throw new Error('Install MetaMask');

    onStatus('Checking Hardhat…');
    await ensureHardhat(eth);
    onStatus('Connecting wallet…');
    await eth.request({ method: 'eth_requestAccounts' });
    var w3 = await getWeb3(eth);
    var addr = w3.addr;

    if (opts.requireWallet) {
      var need = String(opts.requireWallet).toLowerCase();
      if (String(addr).toLowerCase() !== need) {
        throw new Error('MetaMask must be the same Social session wallet');
      }
    }

    var token = new ethers.Contract(net.token, ERC20_ABI, w3.signer);
    var minter = new ethers.Contract(net.minter, MINTER_ABI, w3.signer);
    var nft = new ethers.Contract(net.nft, NFT_ABI, w3.provider);

    try {
      var valid = await minter.isValidUsername(username);
      if (!valid) throw new Error('Invalid username');
    } catch (e) {
      if (/Invalid username/i.test(e.message)) throw e;
    }

    var exists = await nft.exists(username);
    if (exists) throw new Error('Username already taken');

    var price = await minter.costOfName(username);
    var bal = await token.balanceOf(addr);
    if (lt(bal, price)) {
      throw new Error('Insufficient MUZZ balance for mint');
    }

    var allowance = await token.allowance(addr, net.minter);
    if (lt(allowance, price)) {
      onStatus('Approve MUZZ (once)…');
      var txA = await token.approve(net.minter, maxUint());
      await txA.wait();
    }

    onStatus('Minting… confirm in MetaMask');
    var tx = await minter.mintUsername(username);
    var rc = await tx.wait();

    var mintedInfo = {
      name: username,
      username: username,
      wallet: String(addr).toLowerCase(),
      network: net.key || 'demo',
      nft: net.nft,
      mintedAt: Date.now(),
    };
    try {
      if (global.MuzzID && typeof global.MuzzID.saveSessionMuzzId === 'function') {
        global.MuzzID.saveSessionMuzzId(mintedInfo);
      } else {
        sessionStorage.setItem('muzz_id_nft', JSON.stringify(mintedInfo));
        sessionStorage.setItem('muzz_profile_display', username);
        sessionStorage.setItem('muzz_profile_is_nft', '1');
      }
      sessionStorage.setItem('muzz_wallet_address', addr);
    } catch (_) {}

    // Ensure Firebase hub sees MuzzID even if MuzzID helper missing
    if (global.MuzzID && typeof global.MuzzID.syncMuzzIdToFirebase === 'function') {
      global.MuzzID.syncMuzzIdToFirebase(mintedInfo).catch(function () {});
    }

    return {
      username: username,
      address: addr,
      txHash: rc.hash || (rc.transactionHash || ''),
      network: net,
      price: price,
    };
  }

  function isPremium(username) {
    return /[^A-Za-z0-9]/.test(String(username || ''));
  }

  global.MuzzIDMint = {
    netDemo: netDemo,
    connectAndSign: connectAndSign,
    mintUsername: mintUsername,
    getBalance: getBalance,
    pickProvider: pickProvider,
    ensureHardhat: ensureHardhat,
    pingHardhat: pingHardhat,
    isPremium: isPremium,
    ERC20_ABI: ERC20_ABI,
    MINTER_ABI: MINTER_ABI,
    NFT_ABI: NFT_ABI,
  };
})(window);
