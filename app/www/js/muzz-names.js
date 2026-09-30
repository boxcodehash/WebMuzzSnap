/**
 * Display names and the one balance-exempt wallet.
 * Role keys stay ryachu / itsuki / esteban. Only the visible name changes.
 */
(function (global) {
  var ADMINS = {
    ryachu: { wallet: '0x208157b5ec396759e8754058108ecf53e32392ff', name: 'RYASHU', role: 'ryachu' },
    itsuki: { wallet: '0x3e1c5e792fc73e8a2b72df4b0a8a8a462b2ce501', name: 'ITZUKI', role: 'itsuki' },
    esteban: { wallet: '0x875c5a7794b601f273da58e3c1d10671d16130ec', name: 'Esteban', role: 'esteban' }
  };
  var WHITELIST = '0xbeec8f1fee64627f83f0188eae621f367a6bcb8a';

  function norm(address) {
    return String(address || '').trim().toLowerCase();
  }

  function adminOf(address) {
    var wallet = norm(address);
    var keys = Object.keys(ADMINS);
    for (var i = 0; i < keys.length; i += 1) {
      if (ADMINS[keys[i]].wallet === wallet) return ADMINS[keys[i]];
    }
    return null;
  }

  function isWhitelisted(address) {
    return norm(address) === WHITELIST;
  }

  function isAdmin(address) {
    return !!adminOf(address);
  }

  function roleOf(address) {
    var admin = adminOf(address);
    return admin ? admin.role : 'user';
  }

  function nodeName(address) {
    var wallet = norm(address);
    if (!/^0x[a-f0-9]{40}$/.test(wallet)) return 'Node_User';
    return 'Node_' + wallet.slice(isWhitelisted(wallet) ? -6 : -4);
  }

  function displayName(address) {
    var admin = adminOf(address);
    if (admin) return admin.name;
    return nodeName(address);
  }

  var api = {
    ADMINS: ADMINS,
    WHITELIST: WHITELIST,
    norm: norm,
    adminOf: adminOf,
    isWhitelisted: isWhitelisted,
    isAdmin: isAdmin,
    roleOf: roleOf,
    nodeName: nodeName,
    displayName: displayName
  };
  global.MuzzNames = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
