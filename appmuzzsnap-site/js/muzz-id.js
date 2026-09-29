/**
 * MuzzID — resolve & list on-chain username NFTs for Social.
 */
(function (global) {
  'use strict';

  const NFT_ABI = [
    'function primaryUsername(address) view returns (string)',
    'function primaryTokenId(address) view returns (uint256)',
    'function balanceOf(address) view returns (uint256)',
    'function exists(string) view returns (bool)',
    'function nextTokenId() view returns (uint256)',
    'function ownerOf(uint256) view returns (address)',
    'function usernameOf(uint256) view returns (string)',
  ];

  const MINTER_ABI = [
    'event UsernameMinted(address indexed user, string username, uint256 tokenId, uint256 paid, uint256 burned, uint256 toDev)',
    'function costOfName(string) view returns (uint256)',
    'function mintUsername(string) returns (uint256)',
    'function isPremiumUsername(string) view returns (bool)',
    'function flatPrice() view returns (uint256)',
    'function flatPricePremium() view returns (uint256)',
  ];

  const ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
    'function allowance(address,address) view returns (uint256)',
    'function approve(address,uint256) returns (bool)',
    'function mint(address,uint256)',
  ];

  function normalizeAddress(a) {
    return String(a || '').trim().toLowerCase();
  }

  function getConfig() {
    return global.MUZZLE_CONFIG || null;
  }

  function networksFromConfig(cfg) {
    if (!cfg) return [];
    const list = [];
    if (cfg.demo && cfg.demo.muzzleName) {
      list.push({
        key: 'demo',
        chainId: Number(cfg.demo.chainId || 31337),
        rpcUrl: cfg.demo.rpcUrl || 'http://127.0.0.1:8545',
        nft: cfg.demo.muzzleName,
        minter: cfg.demo.minter,
        token: cfg.demo.muzzleToken,
        label: 'Hardhat',
        mock: true,
      });
    }
    if (cfg.sepolia && cfg.sepolia.muzzleName) {
      list.push({
        key: 'sepolia',
        chainId: Number(cfg.sepolia.chainId || 11155111),
        rpcUrl: cfg.sepolia.rpcUrl || 'https://ethereum-sepolia-rpc.publicnode.com',
        nft: cfg.sepolia.muzzleName,
        minter: cfg.sepolia.minter,
        token: cfg.sepolia.muzzleToken,
        label: 'Sepolia',
        mock: true,
      });
    }
    if (cfg.mainnet && cfg.mainnet.muzzleName) {
      list.push({
        key: 'mainnet',
        chainId: 1,
        rpcUrl: 'https://ethereum.publicnode.com',
        nft: cfg.mainnet.muzzleName,
        minter: cfg.mainnet.minter,
        token: cfg.realMuzzleToken,
        label: 'Ethereum',
        mock: false,
      });
    }
    return list;
  }

  function readSessionMuzzId() {
    try {
      const raw = sessionStorage.getItem('muzz_id_nft');
      if (!raw) return null;
      const j = JSON.parse(raw);
      const name = j && (j.name || j.username);
      if (!name) return null;
      return {
        name: String(name),
        tokenId: j.tokenId || null,
        network: j.network || null,
        nft: j.nft || null,
        wallet: j.wallet || null,
        source: 'session',
      };
    } catch (_) {
      return null;
    }
  }

  function saveSessionMuzzId(info) {
    if (!info || !info.name) return;
    const payload = {
      name: info.name,
      username: info.name,
      tokenId: info.tokenId || null,
      network: info.network || null,
      nft: info.nft || null,
      wallet: info.wallet ? normalizeAddress(info.wallet) : null,
      mintedAt: info.mintedAt || Date.now(),
    };
    try {
      sessionStorage.setItem('muzz_id_nft', JSON.stringify(payload));
      sessionStorage.setItem('muzz_profile_display', info.name);
      sessionStorage.setItem('muzz_profile_is_nft', '1');
    } catch (_) {}
    // Fire-and-forget Firebase sync so Profile/Social other devices see it
    syncMuzzIdToFirebase(payload).catch((e) => console.warn('[MuzzID] firebase sync', e));
  }

  function safeKey(v) {
    return String(v || '').replace(/[.#$/\[\]]/g, '_').toLowerCase();
  }

  /**
   * Persist MuzzID under social/users + walletRegistry for hub Profile/feed.
   * Soft-fail if Firebase is not loaded or rules block.
   */
  async function syncMuzzIdToFirebase(info) {
    if (!info || !info.name) return false;
    if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) return false;
    const wallet =
      normalizeAddress(info.wallet) ||
      normalizeAddress(sessionStorage.getItem('muzz_wallet_address'));
    if (!wallet || wallet.startsWith('guest_')) return false;

    try {
      if (!firebase.auth().currentUser) {
        await firebase.auth().signInAnonymously();
      }
    } catch (e) {
      console.warn('[MuzzID] auth for sync', e);
      return false;
    }

    const db = firebase.database();
    const uk = safeKey(wallet);
    const muzzId = {
      name: String(info.name),
      username: String(info.name),
      tokenId: info.tokenId || null,
      network: info.network || null,
      nft: info.nft || null,
      wallet: wallet,
      mintedAt: info.mintedAt || Date.now(),
      syncedAt: Date.now(),
    };
    const patch = {
      wallet: wallet,
      username: muzzId.name,
      displayName: muzzId.name,
      displayMode: 'muzzid',
      muzzId: muzzId,
      lastSeen: firebase.database.ServerValue.TIMESTAMP,
    };

    const writes = [
      db.ref('social/users/' + uk).update(patch),
      db.ref('social/sessions/' + uk).update(patch),
      db.ref('social/walletRegistry/' + wallet).update({
        wallet: wallet,
        username: muzzId.name,
        displayName: muzzId.name,
        displayMode: 'muzzid',
        muzzId: muzzId,
        lastSeen: firebase.database.ServerValue.TIMESTAMP,
      }),
    ];
    // legacy path (may be denied by rules — ignore)
    writes.push(
      db.ref('walletRegistry/' + wallet).update({
        wallet: wallet,
        username: muzzId.name,
        muzzId: muzzId,
        lastSeen: firebase.database.ServerValue.TIMESTAMP,
      }).catch(() => {})
    );

    await Promise.all(writes.map((p) => Promise.resolve(p).catch((e) => {
      console.warn('[MuzzID] write', e && e.message ? e.message : e);
    })));
    return true;
  }

  async function getProvider(rpcUrl) {
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    await Promise.race([
      provider.getBlockNumber(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('rpc timeout')), 2500)),
    ]);
    return provider;
  }

  async function queryPrimary(rpcUrl, nftAddress, wallet) {
    if (!global.ethers || !rpcUrl || !nftAddress || !wallet) return null;
    const provider = await getProvider(rpcUrl);
    const c = new ethers.Contract(nftAddress, NFT_ABI, provider);
    const name = await c.primaryUsername(wallet);
    if (!name || !String(name).trim()) return null;
    let tokenId = null;
    try {
      const tid = await c.primaryTokenId(wallet);
      const s = tid && tid.toString ? tid.toString() : String(tid || '0');
      if (s && s !== '0') tokenId = s;
    } catch (_) {}
    return { name: String(name).trim(), tokenId };
  }

  async function resolveMuzzId(wallet) {
    const w = normalizeAddress(wallet);
    if (!w || w.startsWith('guest_')) return null;

    const cfg = getConfig();
    const nets = networksFromConfig(cfg);

    for (const net of nets) {
      try {
        const hit = await queryPrimary(net.rpcUrl, net.nft, w);
        if (hit && hit.name) {
          const info = {
            name: hit.name,
            isNft: true,
            source: 'chain',
            network: net.key,
            nft: net.nft,
            tokenId: hit.tokenId,
            wallet: w,
          };
          saveSessionMuzzId(info);
          return info;
        }
      } catch (e) {
        console.warn('[MuzzID] RPC', net.key, e.message || e);
      }
    }

    const sess = readSessionMuzzId();
    if (sess && sess.name) {
      if (sess.wallet && normalizeAddress(sess.wallet) !== w) return null;
      return {
        name: sess.name,
        isNft: true,
        source: 'session',
        network: sess.network,
        nft: sess.nft,
        tokenId: sess.tokenId,
        wallet: w,
      };
    }
    return null;
  }

  /**
   * Private list: only call with the connected owner's wallet.
   * Returns [{ tokenId, username, createdAt, createdAtMs, paid, network }]
   */
  async function listMyNfts(wallet) {
    const w = normalizeAddress(wallet);
    if (!w || w.startsWith('guest_')) return [];
    if (!global.ethers) return [];

    const cfg = getConfig();
    const nets = networksFromConfig(cfg);
    const out = [];

    for (const net of nets) {
      if (!net.nft) continue;
      try {
        const provider = await getProvider(net.rpcUrl);
        const nft = new ethers.Contract(net.nft, NFT_ABI, provider);
        const bal = await nft.balanceOf(w);
        if (!bal || bal.toString() === '0') continue;

        // Mint dates from events (owner-only filter by indexed user)
        const mintDates = {};
        const mintPaid = {};
        if (net.minter) {
          try {
            const minter = new ethers.Contract(net.minter, MINTER_ABI, provider);
            const filter = minter.filters.UsernameMinted(w);
            const evs = await minter.queryFilter(filter, 0, 'latest');
            for (const ev of evs) {
              const tid = ev.args.tokenId.toString();
              const block = await provider.getBlock(ev.blockNumber);
              mintDates[tid] = (block && block.timestamp ? block.timestamp : 0) * 1000;
              try {
                mintPaid[tid] = ev.args.paid.toString();
              } catch (_) {}
            }
          } catch (e) {
            console.warn('[MuzzID] events', net.key, e.message || e);
          }
        }

        const next = await nft.nextTokenId();
        const max = Number(next.toString());
        for (let i = 1; i < max; i++) {
          try {
            const owner = await nft.ownerOf(i);
            if (normalizeAddress(owner) !== w) continue;
            const username = await nft.usernameOf(i);
            const createdAtMs = mintDates[String(i)] || null;
            out.push({
              tokenId: String(i),
              username: String(username),
              createdAtMs,
              createdAt: createdAtMs
                ? new Date(createdAtMs).toLocaleString()
                : '—',
              paid: mintPaid[String(i)] || null,
              network: net.key,
              nft: net.nft,
            });
          } catch (_) {
            /* burned / nonexistent */
          }
        }
      } catch (e) {
        console.warn('[MuzzID] list', net.key, e.message || e);
      }
    }

    out.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
    return out;
  }

  function getActiveNetwork() {
    const nets = networksFromConfig(getConfig());
    return nets[0] || null;
  }

  global.MuzzID = {
    resolveMuzzId,
    listMyNfts,
    readSessionMuzzId,
    saveSessionMuzzId,
    syncMuzzIdToFirebase,
    networksFromConfig,
    getConfig,
    getActiveNetwork,
    NFT_ABI,
    MINTER_ABI,
    ERC20_ABI,
  };
})(window);
