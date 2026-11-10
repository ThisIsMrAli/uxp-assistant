(function () {
  function SilentObserver() {
    this._observer = this;
  }
  SilentObserver.prototype.observe = function () {};
  SilentObserver.prototype.unobserve = function () {};
  SilentObserver.prototype.disconnect = function () {};
  SilentObserver.prototype.takeRecords = function () { return []; };

  function install(name) {
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        writable: true,
        value: SilentObserver
      });
    } catch (error) {
      window[name] = SilentObserver;
    }
    globalThis[name] = window[name];
  }

  install("IntersectionObserver");
  install("ResizeObserver");
  if (typeof window.MutationObserver !== "function") install("MutationObserver");

  var tags = {
    HTMLFormElement: "form",
    HTMLInputElement: "input",
    HTMLSelectElement: "select",
    HTMLTextAreaElement: "textarea",
    HTMLButtonElement: "button",
    HTMLIFrameElement: "iframe",
    HTMLOptionElement: "option",
    HTMLLabelElement: "label"
  };

  function ensureSetter(ctor, prop) {
    if (!ctor || !ctor.prototype) return;
    var current = Object.getOwnPropertyDescriptor(ctor.prototype, prop);
    if (current && typeof current.set === "function") return;
    Object.defineProperty(ctor.prototype, prop, {
      configurable: true,
      enumerable: true,
      get: function () {
        return this["__uxp_" + prop];
      },
      set: function (value) {
        this["__uxp_" + prop] = value;
      }
    });
  }

  var name;
  for (name in tags) {
    if (typeof globalThis[name] === "function") continue;
    var ctor = null;
    try {
      var el = document.createElement(tags[name]);
      if (el && typeof el.constructor === "function" && el.constructor !== Object) ctor = el.constructor;
    } catch (error) {
      ctor = null;
    }
    if (!ctor) ctor = function MissingDomElement() {};
    globalThis[name] = ctor;
    try {
      window[name] = ctor;
    } catch (error) {
      /* Premiere may already own the binding. */
    }
  }
  ensureSetter(globalThis.HTMLInputElement, "checked");
  ensureSetter(globalThis.HTMLInputElement, "value");
  ensureSetter(globalThis.HTMLSelectElement, "value");

  if (typeof NodeFilter !== "function" && typeof NodeFilter !== "object") {
    var Filter = function NodeFilter() {};
    Filter.FILTER_ACCEPT = 1;
    Filter.FILTER_REJECT = 2;
    Filter.FILTER_SKIP = 3;
    Filter.SHOW_ALL = 4294967295;
    Filter.SHOW_ELEMENT = 1;
    Filter.SHOW_TEXT = 4;
    Filter.SHOW_COMMENT = 128;
    globalThis.NodeFilter = Filter;
    try {
      NodeFilter = Filter;
    } catch (error) {
      /* The assignment above is enough when the name is already bound. */
    }
  }

  function collectElements(root, into) {
    var child = root && root.firstChild;
    while (child) {
      if (child.nodeType === 1) {
        into.push(child);
        collectElements(child, into);
      }
      child = child.nextSibling;
    }
    return into;
  }

  function makeTreeWalker(root, whatToShow, filter) {
    var nodes = [];
    var all = collectElements(root, []);
    var i;
    for (i = 0; i < all.length; i += 1) {
      var node = all[i];
      var verdict = 1;
      try {
        if (typeof filter === "function") verdict = filter(node);
        else if (filter && typeof filter.acceptNode === "function") verdict = filter.acceptNode(node);
      } catch (error) {
        verdict = 1;
      }
      if (verdict === 1) nodes.push(node);
    }
    var index = -1;
    return {
      root: root,
      currentNode: root,
      whatToShow: whatToShow || 1,
      filter: filter || null,
      nextNode: function () {
        index += 1;
        if (index >= nodes.length) return null;
        this.currentNode = nodes[index];
        return this.currentNode;
      },
      previousNode: function () {
        if (index <= 0) return null;
        index -= 1;
        this.currentNode = nodes[index];
        return this.currentNode;
      }
    };
  }

  function hardenDocument(doc) {
    if (!doc || doc === document) return document;
    if (typeof doc.createElement !== "function") {
      doc.createElement = function (tag, options) {
        return document.createElement(tag, options);
      };
    }
    if (typeof doc.createElementNS !== "function") {
      doc.createElementNS = function (ns, tag) {
        return document.createElementNS ? document.createElementNS(ns, tag) : document.createElement(tag);
      };
    }
    if (typeof doc.createTreeWalker !== "function") {
      doc.createTreeWalker = function (root, whatToShow, filter) {
        return makeTreeWalker(root, whatToShow, filter);
      };
    }
    if (!doc.defaultView) doc.defaultView = window;
    if (!doc.body) doc.body = document.body;
    return doc;
  }

  var nodeProto = window.Node && Node.prototype;
  if (nodeProto) {
    var ownerDesc = Object.getOwnPropertyDescriptor(nodeProto, "ownerDocument");
    var ownerGet = ownerDesc && ownerDesc.get;
    try {
      Object.defineProperty(nodeProto, "ownerDocument", {
        configurable: true,
        get: function () {
          if (this && this.nodeType === 9 && typeof this.createElement === "function") return this;
          var value = null;
          try {
            value = ownerGet ? ownerGet.call(this) : null;
          } catch (error) {
            value = null;
          }
          if (!value) return document;
          return hardenDocument(value);
        }
      });
    } catch (error) {
      /* Leave the host getter when it cannot be replaced. */
    }
  }

  if (!document.defaultView) {
    try {
      Object.defineProperty(document, "defaultView", {
        configurable: true,
        get: function () {
          return window;
        }
      });
    } catch (error) {
      document.defaultView = window;
    }
  }

  if (window.Document && Document.prototype) {
    Document.prototype.createTreeWalker = function (root, whatToShow, filter) {
      return makeTreeWalker(root, whatToShow, filter);
    };
  }

  if (window.Element && Element.prototype.setAttribute) {
    var setAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (attr, value) {
      if ((attr === "stroke" || attr === "fill") && value === "currentColor") value = "#d8d8d8";
      if ((attr === "width" || attr === "height") && /^[\d.]+$/.test(String(value))) value = String(value) + "px";
      return setAttribute.call(this, attr, value);
    };
  }

  try {
    window.localStorage.getItem("__uxp_assistant_probe");
  } catch (error) {
    var memory = {};
    var store = {
      getItem: function (key) {
        return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
      },
      setItem: function (key, value) {
        memory[String(key)] = String(value);
      },
      removeItem: function (key) {
        delete memory[key];
      },
      clear: function () {
        memory = {};
      },
      key: function (index) {
        return Object.keys(memory)[index] || null;
      }
    };
    Object.defineProperty(store, "length", {
      get: function () {
        return Object.keys(memory).length;
      }
    });
    try {
      Object.defineProperty(window, "localStorage", { configurable: true, value: store });
    } catch (defineError) {
      window.localStorage = store;
    }
  }

  // UXP has no TextEncoder or TextDecoder. Packages such as qrcode call them.
  // cep-to-uxp refuses those calls. This guard supplies UTF-8 so a package can run.
  function utf8Encode(input) {
    var text = String(input);
    var bytes = [];
    var i;
    for (i = 0; i < text.length; i += 1) {
      var code = text.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
        var next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          code = ((code - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
          i += 1;
        }
      }
      if (code < 0x80) bytes.push(code);
      else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
    return new Uint8Array(bytes);
  }

  function utf8Decode(input) {
    var bytes = input ? new Uint8Array(input.buffer || input, input.byteOffset || 0, input.byteLength != null ? input.byteLength : input.length) : new Uint8Array();
    var out = "";
    var i = 0;
    while (i < bytes.length) {
      var b = bytes[i];
      i += 1;
      var point;
      if (b < 0x80) point = b;
      else if (b < 0xe0) {
        point = ((b & 0x1f) << 6) | (bytes[i] & 0x3f);
        i += 1;
      } else if (b < 0xf0) {
        point = ((b & 0x0f) << 12) | ((bytes[i] & 0x3f) << 6) | (bytes[i + 1] & 0x3f);
        i += 2;
      } else {
        point = ((b & 0x07) << 18) | ((bytes[i] & 0x3f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
        i += 3;
      }
      if (point > 0xffff) {
        point -= 0x10000;
        out += String.fromCharCode(0xd800 + (point >> 10), 0xdc00 + (point & 0x3ff));
      } else out += String.fromCharCode(point);
    }
    return out;
  }

  // A bare `new TextEncoder()` throws in UXP even after `window.TextEncoder = ...`
  // when the package runs inside a module. Publish the name on every global object.
  var root = typeof globalThis !== "undefined" ? globalThis : window;
  if (typeof root.TextEncoder !== "function") {
    function Encoder() {}
    Encoder.prototype.encode = function (input) { return utf8Encode(input); };
    Encoder.prototype.encodeInto = function (input, dest) {
      var encoded = utf8Encode(input);
      var written = Math.min(encoded.length, dest.length);
      dest.set(encoded.subarray(0, written));
      return { read: String(input).length, written: written };
    };
    root.TextEncoder = Encoder;
    try { window.TextEncoder = Encoder; } catch (error) { /* window may be frozen */ }
  }
  if (typeof root.TextDecoder !== "function") {
    function Decoder() {}
    Decoder.prototype.decode = function (input) { return utf8Decode(input); };
    root.TextDecoder = Decoder;
    try { window.TextDecoder = Decoder; } catch (error) { /* window may be frozen */ }
  }
})();
