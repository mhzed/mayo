// mayo, an async js template engine
// (c) Zed Zhou,  https://github/mhzed/mayo

(function () {
var root = this;
function makeMayo(_) {

// _block is private class, the run time component of template
function _block (name, filter, source, indentStr) {
    this.$blockTag = true;
    this.name = name;
    this._filter = filter; // filter function
    this.body = [];
    this.stack = [];
    this.source = source;
    this._indentStr = indentStr;
    if (source) this.evaluator = source.evaluator;

    this.asyncQueueSize = 0;
};

_block.prototype.__throwStr = function(str) {
    return str + ".  At " + _.basename(this.source.url) +  "[" + (this.name||'') + "]";
};

// * block(), extendBlock(), filter() are only called on root block
// Defines a block with specified name, or overrides block defined in extended template (extend keyword) with same name
// A block encloses a section in the template so that it could be extended or overridden in a inheritance tree
// name:  String, each block must have a name
_block.prototype.block = function(name, cb) {
    if (!name) throw new Error(this.__throwStr("Template block must have name"));
	var block = new _block(name, null, this.source);
    this.__where().body.push(block);
    this.stack.push(block);
    if (cb)
        cb.call(this);
    this.stack.pop();
	return this;
};

// When inside a block, insert super block (block of same name defined in the base template )
_block.prototype.insertSuper = function() {
    if (this._base) {
        var pblock = this._base.find(this.__where().name);
        if (pblock) {
            _(this.__where().body).append(pblock.body);
        }
    }
    return this;
};

// Override super block but keep its content.
// Alias for: this.block('name').insertSuper();
_block.prototype.extendBlock = function(name, cb) {
    var self = this;
	this.block(name, function() {
        self.insertSuper();
        if (cb)
            cb.call(self);
    });
    return this;
};
// Filter allows enclosed content to be processed by the provided filter function
// filterFunc:  the filter function
// I.e. this.beingFilter(xmlEscape).embed("a.xml").end();
_block.prototype.filter = function(filterFunc, cb) {
    var block = new _block(null, filterFunc, this.source, false);
    this.__where().body.push(block);
    this.stack.push(block);
    if (cb)
        cb.call(this);
    this.stack.pop();
    return this;
};

// block()/filter() must all end with end() call
_block.prototype.end   = function() {
    this.stack.pop();
    return this;
};

// Find sub-bock of specified name, recursively
_block.prototype.find = function(name) {
    for (var i=0, n=this.body.length; i<n; i++) {
        var e = this.body[i];
        if (e.$blockTag) {
            if (e.name && e.name === name )
                return e;
            else {
                var ret = e.find(name);
                if (ret) return ret;
            }
        }
    }
    return null;
};

// Returns root block: the out-most block that embeds or extends other templates.
// Example:  file1 extends file2, file2 extends file 3, file1 embeds chunk1, chunk1 extends chunk2
//           file1 will contain the root block, in file2/file3/chunk1/chunk2, code "this.root()" will always
//           point to the block defined in file1
_block.prototype.root = function() {
    var b = this;
    while (b._outer) b = b._outer;
    return b;
};

// To execute a async function inside template.  Async calls may also be nested inside each other.
// callObj:  bind as "this" to the callFunc (optional)
// callFunc:  the async function object to call
// ....  : the parameters to pass to callFunc
// Example:
// to execute dal.read(key, cb), do:
// -- this.async(dal, dal.read, key, function(err, rows) {
// <tr><td>#{rows[0]['col']}</td></tr>
// -- });
_block.prototype.async = function(callObj, callFunc /*,...*/) {
    // parameter processing
    var args;
    if (_(callObj).isFunction()) {
        args = [].splice.call(arguments,0).slice(1);    // get rest of arguments in array
        // must be after above slice, as it actually modifies arguments object
        callFunc = callObj;
        callObj = null;
    }
    else
        args = [].splice.call(arguments,0).slice(2);    // get rest of arguments in array

    // find the real async callback
    var cb, icb;
    for (icb = args.length-1; icb >= 0; icb--)
        if (_(args[icb]).isFunction()) break;
    if (icb==-1)
        throw new Error("No callback function parameter found to the async call");
    cb = args[icb].bind(this);            // override this in callback, so that this still points to block

    // insert a asyncBlock where the async call is taking place
    var asyncBlock = new _block(null, null, this.source);
    this.__where().body.push(asyncBlock);

    // wrap the real async cb inside a wrapper, for overriding this.print, and when all callbacks are done, call the real
    // render callback
    var currentBlock = this;        // this block is always associated with a file unit
    if (!currentBlock.asyncErrs) currentBlock.asyncErrs = [];
    currentBlock.asyncQueueSize ++;

    var wrapcb = function() {
        var cbErr = arguments[0];
        if (cbErr) _(currentBlock.asyncErrs).append(cbErr);
        currentBlock.stack.push(asyncBlock);
        try {// if exception is thrown in cb, catch it and pass to _runCb
            cb.apply(currentBlock, [].splice.call(arguments,0));    // call cb, pass in all arguments in wrapcb, and override this to be currentBock
        } catch (e) {
            _(currentBlock.asyncErrs).append(e);    // eat thrown error, give to async callback
        }
        currentBlock.stack.pop();

        currentBlock.asyncQueueSize--;
        if (currentBlock.asyncQueueSize == 0 && currentBlock._runCb) {
            // last async call is executed, call _runCb
            // currentBlock._runCb could be NULL if callFunc is NOT a async call, in such case, see _run line 205
            var runcberr ;
            if (currentBlock.asyncErrs.length==1) runcberr = currentBlock.asyncErrs[0];
            else if (currentBlock.asyncErrs.length>1) runcberr = currentBlock.asyncErrs;
            currentBlock._runCb(runcberr, currentBlock);
        }
    };
    args[icb] = wrapcb;
    // proceed with calling the actual callback
    callFunc.apply(callObj, args);
    return this;
}

// For use in the template to print content to output
_block.prototype.print = function() {
    var body = this.__where().body;
    // body can only contain two types of object, String or block, adjacent string pieces are automatically joined
    // together so that _join call is faster (this is important as _join() result is not cached)
    for (var i=0; i<arguments.length; i++) {
        var a = arguments[i];
        if (a === undefined || a === null)
            ;
        else if (a.$blockTag)
            body.push(a);
        else {
            var last = body.length>0?body[body.length-1]:undefined;
            if (last && !last.$blockTag)
                // * do not use:  last += '';   in js this only modifies the local var last, but not body[body.length-1]
                body[body.length-1] += (""+a);
            else
                body.push(""+a);
        }
    }
    return this;
};

// Private run helper, async function
// param:  the parameter object to pass to the template run time
// cb:     function(err, block), called after run is completed.
//
_block.prototype._run = function(param , cb) {
    var self = this;
    if (self.body.length>0) {   // already ran before, i.e. cached block
        _.nextTick(function() { cb(null, self); });
        return ;
    }
    self.__runParam = param || {};

    try {
        self.evaluator(self.__runParam);
        self._runCb = function(err, block) {
            if (!err) {
                // update cache if required
                self.source.updateBlockCache(self);
            }
            cb(err, block);
        };
        if (self.asyncQueueSize == 0)
            _.nextTick(function() {self._runCb(null, self);});
    } catch (e) {
        _.nextTick(function() {cb(e);});
    }
};

_block.prototype._runSync = function(param) {
    this.__runParam = param || {};
    this.evaluator(this.__runParam);
    if (this.asyncQueueSize != 0) throw new Error("Async calls not supported in sync run");
};

// Run template and produce the final output
// param: the parameter object to pass to the template run time
// cb:    function(err, content), content is the final output
_block.prototype.render = function(param, cb) {
    this._run(param, function(err, block){
        cb(err, block?block._join():"");
    });
};

_block.prototype.renderSync = function(param) {
    this._runSync(param);
    return this._join();
};
    
// private helper for process embed/extend parameter
// template:  could be url (string), or a template object
// cb : function(err, block)
_block.prototype._getTemplate = function(template, runParam, cb) {
    var self = this;
    var url, serverUrlPath;
    if (_(template).isString()) url = template;
    else if (template.$class && template.$class=='mayo') {
        // when embed or extend another mayo object, we don't use the object passed in from parameter, but rather
        // do a separate load (to utilize serialized async and caching facilities)
        url = template.url;
        serverUrlPath = template.serverUrlPath;
    }
    else throw new Error(_("Invalid object of type %s to embed").format(typeof template));

    this.source._loadOther(url, function(err, mayo) {
        if (!err) {
            if (serverUrlPath)
                mayo.serverUrlPath = serverUrlPath;

            var block = mayo.runtime(runParam);
            if (self.serverUrlPath && !block.serverUrlPath)
                block.serverUrlPath = _.pathjoin(_.dirname(self.serverUrlPath), url);
            cb(null, block);
        }
        else cb(err);
    })

};

// Embed another template:
// template:  if String, then the url of template source,  or a mayo template object
// param:     optional, the parameter to pass to embedded template runtime
// indentStr: optional, render embedded content with indent
// cb:        function(err), embed completion callback, can be omitted

_block.prototype.embed = function(template, param, indentStr, cb) {
    var self = this;
    if (_(param).isFunction()) {
        cb = param;
        param = undefined;
        indentStr = undefined;
    } else if (_(indentStr).isFunction()) {
        cb = indentStr;
        indentStr = undefined;
    }
    // if self parameter contains 'req' or 'res', also pass to embedded template
    var embedParam =_(self.__runParam).chain().pick(function(v,k) {
        return (k=='req' || k=='res' || k=='next');
    }).extend(param).value();

    function _asyncEmbed(template, embedParam, cb) { // tie two async function together
        self._getTemplate(template, embedParam, function(err, innerBlock) {
            if (err) cb(err);
            else {
                innerBlock._outer = self;
                innerBlock._run(embedParam, cb);
            }
        });
    }

    self.async(null, _asyncEmbed, template, embedParam, function(err, innerBlock) {
        if (!err) {
            var l = self.__where();
            var embedBlock = innerBlock._copy();
            embedBlock._indentStr = indentStr;
            l.body.push(embedBlock);
            //l.body.push.apply(l.body, innerBlock.body);
        }
        if (cb) cb.call(this,err);
    });
    return this;
};

// private helper for constructing a name block dictionary inside a block.
function _makeBlockMap(block, map) {
    _(block.body).each(function(e) {
        if (e.$blockTag) {
            if (e.name) map[e.name] = e;
            _makeBlockMap(e, map);
        }
    })
};

// Extend another template.  The main document structure is defined in base (extended) template.  This template
// defines the blocks to override (block(name)) or extend (extendBlock(name))
//
// template:  if String, then the url of template source,  or a mayo template object
// param : parameter to pass to base block run time, optional
// cb(err) : completion callback
// example:
// --  this.extend("base.html", {x:1}, function(err) {
// ... the usual template code
// --  });
_block.prototype.extend = function(template, param, cb) {
    var self = this;
    if (this._extended) throw new Error("Can not extend twice");
    else this._extended = true;

    if (_(param).isFunction()) {
        cb = param;
        param = undefined;
    }
    if (!cb) throw new Error("Must provide callback to extend");

    var extendParam =  _(self.__runParam).chain().pick(function(v,k) {
        return (k=='req' || k=='res'|| k=='next');
    }).extend(param).value();

    function _asyncExtend(template, extendParam, cb) { // tie two async function together
        self._getTemplate(template, extendParam, function(err, baseBlock) {
            if (err) cb(err);
            else {
                baseBlock._outer = self;
                baseBlock._run(extendParam, cb);
            }
        });
    }

    self.async(null, _asyncExtend, template, extendParam, function(err, baseBlock) {
        if (!err)
            self._base = baseBlock;

        cb.call(self, err);    // run template code, bound to this block
        if (!err) {
            var myblocks = {};
            _makeBlockMap(self, myblocks);  // make a dictionary of named maps defined in this template

            // copy _base's body (create block and body, all other members are shallow copied)
            // can not do self._base._applyOverride as it modifies self._base's run result, which maybe cached
            self.body = self._base._copy().body;
            self._applyOverride(myblocks);
        }
    });
    return this;
};
// Inside a template file in server context, use this.linkLocal(relativePath) to link to files using relative path to
// this template file, this ensures the path doesn't "float" when this template file is embedded or extended by other
// files in different path
// serverUrlPath is used to determine the actual url location of mayo in server context, because:
// 1. mayo can be embed-ed and extend-ed
// 2. embed-ed or base mayo may refer to external resource with path relative to itself, which must be constant (does
//    not float with files that embed or extend it).  To ensure this constant-ness, we keep serverUrlPath member and
//    then use this.linkLocal(relative_path) helper.
// serverUrlPath maybe set in multiple places
// 1. in zeor/lib/module.js, each Mayo object within a zero module has serverUrlPath set
// 2. in sdir.runMayo, serverUrlPath is set if not already set
// 3. in extend() or embed(), the embed-ed or extend-ed block has serverUrlPath set relative to this block
// parameter req:  if provided, include full url (http://host/path)
_block.prototype.linkLocal = function(relpath, req) {
    if (this.serverUrlPath)   {// only set in server context
        var path = _.pathResolve(_.dirname(this.serverUrlPath), relpath);
        if (req)
            return _("%s://%s%s").format(req.scheme, req.headers.host, path);
        else
            return path;
    }
    else
        return relpath;
};

// Private: the class to be thrown to abort when mayo is executed in a server context, see sdir.js
function AbortClass() {};
// abort sending this template to client (because response is written in async call back)
_block.prototype.abort = function() {
    throw new AbortClass();
};

// 'clone' a block:  basically clone body, all other attributes are shallow-copied
_block.prototype._copy = function() {
    var ret = new _block(this.name, this._filter, this.source,this._indentStr);
    for (var i=0; i<this.body.length; i++) {
        var e = this.body[i];
        if (e.$blockTag)
            ret.body[i] = e._copy();
        else
            ret.body[i] = e;
    }
    return ret;
};

// Recursively apply block overrides defined in blockMap ( name => block)
// - if a named block in blockMap matches a named block in this, use the one in blockMap
_block.prototype._applyOverride = function(blockMap) {
    for (var i=0, n=this.body.length; i<n; i++) {
        var e = this.body[i];
        if ( e.$blockTag) {
            if (e.name && blockMap[e.name] !== undefined ) {
                this.body[i] = blockMap[e.name];
                //delete blockMap[e.name];
                this.body[i]._applyOverride(blockMap);
            }
            else    // recursively apply block override
                e._applyOverride(blockMap);
        }
    }
};

// Private: returns the current block;
_block.prototype.__where = function() {
    return this.stack.length==0?this:this.stack[this.stack.length-1];
};
// Private: stitch body together for the final content
_block.prototype._join = function() {
    ret = '';
    var self = this;
    for (var i=0; i<this.body.length; i++) {
        var e = this.body[i];
        if (e.$blockTag)
            ret += e._join();
        else
            ret += e;
    }
    if (this._indentStr) {      // insert indent in rendered output
        var lines = ret.split(/\n/);
        ret = '';
        _(lines).each(function(line) {
            ret += self._indentStr;
            ret += line;
            ret += "\n";
        })
    }
    return this._filter?this._filter(ret):ret;
};

/////////////////////////////////////////////////////////////////
// The template constructor, private, don't call this directly, use mayo.run | mayo.runUrl | mayo.load to run
// or load templates
// absUrl : url location of template. * the template is NOT loaded in constructor
/////////////////////////////////////////////////////////////////
function Mayo(absUrl) {
    this.$class = 'mayo';
    if (absUrl) this.url = absUrl;
    this.directives = {};   // store key/val pairs specified as --@ key:value
}

Mayo.AbortClass = AbortClass;
Mayo.__permanent = true;
Mayo.config = {
    directiveCh   : '@',

    lineMarker    : '--',       // marker for begin of code, terminated by \n
    exprClosure   : '#{?}',     // marker for embed expression
    xcapeMarker   : '!'         // when inside of exprClosure, shortcut for xcape(...)
};

// private, run code inside a js Function object, for run template in browser
// strCode : parsed template code (executable javascript source)
Mayo.prototype._asFunc = function(strCode) {
    try {
        this.evaluator = new Function('param', strCode);
    } catch (e) {
        throw new Error("Error in template " + this.url + ": " + e.stack + "\n" + strCode);
    }
};

// Private:  run code as a nodejs module, for run in nodejs env.  The benefit is that you may use require
// as you would in standard nodejs source code, and error message will point to correct filename:linenumber
//
// strCode : parsed template code (executable javascript source)
Mayo.prototype._asModule = function(strCode) {
    try {
        var fs = require("fs");
        // in node.js use module system to _parse/load converted template source, this gives us clear strack trace (with
        // correct filename:line) in run time error, this is done by creating a temp file and uses node's require to load it
        var tempFileUrl = this.url + "_";
        fs.writeFileSync(tempFileUrl, "module.exports = function(param) { " + strCode + "};");
        this.evaluator = require(tempFileUrl);
        fs.unlink(tempFileUrl);     // delete right away
    } catch (e) {
        throw new Error("Error in template " + this.url + ": " + e.stack + "\n" + strCode);
    }
};

// Given template content and parameter, directly run and render final output
// strContent : the template content
// params     : template parameter
// cb(err, content): rendered callback, content is the rendered content
Mayo.run = function(strContent, params, cb) {
    var m = new Mayo();
    try {
        m._asFunc(m._parse(strContent));
    } catch (e) {
        cb(e);
        return;
    }
    return m.runtime().render(params, cb);
};
Mayo.runSync = function(strContent, params) {
    var m = new Mayo();
    m._asFunc(m._parse(strContent));
    return m.runtime().renderSync(params);
}
// Given url to template, load/run/render it
// url        : url pointing to the template source
// params     : template parameter
// cb(err, content): rendered callback, content is the rendered content
Mayo.runUrl = function(url, params, cb) {
    Mayo.load(url, function(err, mayo) {
        if (!err)
            mayo.runtime(params).render(params, cb);
        else
            cb(err);
    })
}

Mayo.cache = {};    // the static template cache

Mayo.clearCache = function() {
    delete Mayo.cache;
    Mayo.cache = {};
};

// The core loader that does:
// 1. serializing async callbacks, if multiple load is called on same url, only first call actually does the loading
//    all subsequent calls wait until first load completes and then use cached value (if no error occurred)
// 2. cache loaded (also parsed) template object in the global cache, to be reused later
// url : could be local filesystem path, or http|https urls.  In nodejs, currently only file system path is supported
// cb :  function(err, mayo), the loaded mayo template object
// factoryCb: function(absUrl), the factory method for creating template object, optional (marble uses it)
Mayo.load = function(url, cb, factoryCb)  {
    if (!url) throw new Error("url must be specified");

    var absUrl =  _.pathResolve(url);
    if (absUrl in Mayo.cache) {
        var  v = Mayo.cache[absUrl];
        if ('mayo' == v.$class) {   // already loaded and cached, call immediately
            _.nextTick(function() { // ensure async-ness
                cb(null, Mayo.cache[absUrl]);
            });
        } else {
            Mayo.cache[absUrl].push(cb);   // being loaded, save cb to be called later
        }
    }
    else {
        Mayo.cache[absUrl] = [];           // start being loaded
        var mayo = factoryCb? factoryCb(absUrl): new Mayo(absUrl);

        Mayo._readUrl(mayo.url, function(err, content) {
            if (!err) {
                try {
                    if (_.env == "module")
                        mayo._asModule(mayo._parse(content));
                    else
                        mayo._asFunc(mayo._parse(content));
                } catch (e) {
                    err = e;
                }
            }
            // following logic is to ensure that queued async callbacks are executed sequentially
            // order of statements is very important here
            // must refresh Mayo.cache before calling callbacks, as callbacks may also call load
            var cbQueue = Mayo.cache[mayo.url];
            delete Mayo.cache[mayo.url];

            if (!err)   // save cache if no error
                Mayo.cache[mayo.url] = mayo;

            cb(err, mayo);

            if (cbQueue) {
                _(cbQueue).each(function(cb) {  // call queued callbacks
                    cb(err, mayo);
                });
            }
        });
    }
};

// private load used when there is embed/extends call in the template
Mayo.prototype._loadOther = function(relpath, cb) {
    if (_.isAbsPath(relpath))
        Mayo.load(relpath, cb);
    else
        Mayo.load(_.pathjoin(_.dirname(this.url), relpath), cb);
}

// Private url reader, if you know what you are doing, override to support more types of resources
// TODO : support read from http|https in nodejs? And ftp|ssh .... ?
Mayo._readUrl = function(url, cb) {
    if (_.env == "module") {
        var fs = require("fs");
        return fs.readFile(url, 'utf8', cb);
    } else {
        // Client side:  dependent on jquery
        if (!jQuery)
            throw new Error("Require jquery");
        jQuery.ajax({
            url : url,
            type: 'GET',
            headers: {
                "x-zero-mayo" : "1"
            },
            success: function(data, textStatus, xhr) {
                cb(null, data);
            },
            error : function(xhr, textStatus, errorThrown) {
                cb(errorThrown);
            }
        });
    }
};

// Private, the source parser
Mayo.prototype._parse = function(strContent) {
    if (/^\uFEFF/.test(strContent)) {   // remove windows utf8 BOM marker
        strContent = strContent.slice(1);
    }

    var self = this;
    if (self._parseHook) {
        strContent = self._parseHook(strContent);
    }
	function _wrapPrint(expr) {
		return '_mayo.print(' + expr + ');';    // legal js and legal coffee
	}
	function _wrapText(str) {
	    return _wrapPrint("'" + str.replace(/\\/g, '\\\\').replace(/'/g,  "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n') + "'");
	}
    var regexDotSlash = /^([\S\s]*?["'])(\.{1,3}\/)([\S\s]*)$/;   // [\S\s] is . with dotall option    
	function _wrapTextHandleDotSlash(txt) { // wrap text block that contains ./ ../ .../ after ' or "
        if (txt.length==0) return "";
        var regMath;
        var ret = "";
        while (regMath = regexDotSlash.exec(txt)) {
            ret += _wrapText(regMath[1]);
            if (regMath[2] == ".../")
                ret += _wrapPrint("_mayo.linkLocal('./', param.req)"); // include http://host/
            else
                ret += _wrapPrint("_mayo.linkLocal('" + regMath[2] + "')");
            txt = regMath[3];
        }
        ret += _wrapText(txt);
        return ret;
    }
        	
    function _wrapContent(str, regExprClosure) {    // wrap text block that contains #{} embed
        if (str.length==0) return "";
        var ret = "", match;    // indent code as text is indented, because of coffee script syntax
        if (regExprClosure) {
            while (match = regExprClosure.exec(str)) {
                if (_(match[1]).last() == '\\') {   // change \#{ to #{
                    ret += _wrapTextHandleDotSlash(_(match[1]).cut(1) + match[2] + match[3]+ match[4]);
                    str = match[5];
                }
                else {
                    ret += _wrapTextHandleDotSlash(match[1]);
                    if (match[3][0] == Mayo.config.xcapeMarker)
                        ret += _wrapPrint("xcape("+match[3].slice(1)+")");
                    else
                        ret += _wrapPrint(match[3]);
                    str = match[5];
                }
            }
            ret += _wrapTextHandleDotSlash(str);
        }
        else {
            ret += _wrapTextHandleDotSlash(str);
        }
        return ret;
    }
    
    var regExprClosure;    // '#{?}'      // marker for embed expression
    if (Mayo.config.exprClosure) {
        var toks = Mayo.config.exprClosure.split('?');
        if (toks.length==2) {
            var exprClosureBeg = _.escapeRegExp(toks[0]), exprClosureEnd = _.escapeRegExp(toks[1]);
            regExprClosure = new RegExp(_("^([\\S\\s]*?)(%s)([^\\n%s]*?)(%s)([\\S\\s]*)$").format(exprClosureBeg, exprClosureEnd, exprClosureEnd));
        }
    }

    var strCode = " ";
    (function() {   // for creating var scope
        var lines = strContent.split(/\n/);
        var slreg = new RegExp(_("^(\\s*)([\\\\]*)%s([\\s\\S]*)$").format(_.escapeRegExp(Mayo.config.lineMarker)));
        var inCodeBlock = false;

        var lastContentIndent = null;
        _(lines).each(function(line, i) {
		    if (i) {
                if (self.isCoffee) {
                    strCode += "\n";
                    strCode += " ";
                } else
                    strCode += "\n";
            }

            var m = slreg.exec(line);
            if (m) {    // code detected cuz Mayo.config.lineMarker found
                var indent = m[1], escapeCh = m[2], remainder = m[3];
                if (escapeCh) { // \-- is found, it's an escape of --, not really code
                    line = line.replace("\\"+Mayo.config.lineMarker, Mayo.config.lineMarker);
                }
                else {  // code is found
                    // handle code block flag
                    var lineContent = _.trim(remainder);
                    if (lineContent.length == 0)
                        // -- on a line by itself marks beg or end of code segment
                        inCodeBlock = !inCodeBlock;
                    else {
                        // -- with code always mark block to end
                        inCodeBlock = false;
                        // convert code
                        var m;
                        if (lineContent[0] == Mayo.config.directiveCh &&
                            (m = /^\s*\((.*)\)\s*$/.exec(lineContent.slice(1))) // @(...)
                            ) {
                            // handles directives, identified by --@ key: content...
                            m = /^\s*(\w+)\s*(:?.*)$/.exec(m[1]);
                            if (m && (m[2]=='' || m[2][0] ==':') ) { // @(key) or @(key : )
                                self.directives[m[1]] =  _(m[2]).cut(-1);
                                if (m[1] == 'coffee') {
                                    self.isCoffee = true;
                                }
                            }
                            else
                                throw new Error(_.format("Invalid directive: %s", lineContent));
                        }
                        else {  // is code
                            var lCode = indent+remainder; // preserve indentation
                            if (self.isCoffee) {
                                if (lastContentIndent != null) { // content to code edge detected
                                    var codeIndent = /^(\s*)/.exec(lCode)[1];
                                    if (codeIndent.length > lastContentIndent.length) {
                                        // place "do=>" at last line, so that codeIndent is legal in coffee
                                        var ilasteol = strCode.lastIndexOf('\n');
                                        strCode = strCode.slice(0, ilasteol) + "; do=>\n" + strCode.slice(ilasteol+1);
                                    }
                                }
                            }
                            strCode += lCode;
                        }
                    }
                    lastContentIndent = null;
                    return; // continue loop
                }
            }
            // code marker not detected
            if (inCodeBlock)  // is code
                strCode += (line);
            else {  // is text
                if (!/^\s*$/.test(line)) {  // only if there is stuff to write
                    // in generated src, block of code to write text should have same indent, for coffee-script
                    var indent = /^(\s*)/.exec(line)[1];
                    if (lastContentIndent==null) lastContentIndent = indent;
                    if (indent.length > lastContentIndent.length) indent = lastContentIndent;

                    strCode += indent;
                    strCode += (_wrapContent(line+"\n", regExprClosure));
                }
            }
        })
    })();
    var func_xcape = "function xcape(s) {return (''+s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&#x27;').replace(/\\//g,'&#x2F;');};";
    // if first line not empty, insert extra \n or coffee compiler will fail, but this messes compile error line
    // number display (reported = actual+1), so add only if necessary.
    var first_line_empty = /^\s*\n/.test(strCode);
    if (!first_line_empty) strCode = "\n"+strCode;
    var retContent = self.isCoffee ?
        "_mayo = this; (_with = (o, f)-> (this[k]=v for own k,v of o) && f.call(_mayo)); _with param, -> "
            + strCode + "\n`" + func_xcape + "`"
        :
        "var _mayo = this; with (param) {" + strCode + "};" + func_xcape ;

    if (this.isCoffee) {
        try {
            if (root.coffee)
                retContent = root.coffee.compile(retContent);
            else
                retContent = require("coffee-script").compile(retContent);
        } catch (e) {

            throw new Error(e.toString() + " at " + this.url + "\n====== Compiled coffee-script source:\n" + strCode + "\n====== End =====");
        }
    }
    //console.log(strCode);
    return retContent;
};

function evalCacheKey(cacheDirective, param) {
    if (cacheDirective!=="") {
        with (param) {
            eval("var __cacheKey = " + cacheDirective);
        }
        return __cacheKey;
    }
    else return "";
}
// Return the runtime object
// param :    optional, the run parameter that you would pass to .render() call of returned block,  if specified
//            then runtime caching would be used (for templates with @cache directive)
// Example:   template.runtime().render({x:1}, function(err, content) {});
Mayo.prototype.runtime = function(param) {
    var needCache = 'cache' in this.directives;
    var cacheDirective = this.directives['cache'];
    if (param && needCache && this.runCache) {
        var key = evalCacheKey(cacheDirective, param);
        if (key in this.runCache) return this.runCache[key];
    }

    var ret = new _block("", null, this);
    ret.serverUrlPath = this.serverUrlPath; 
    return ret;
};

Mayo.prototype.updateBlockCache = function(block) {
    if (block.$cached) return;
    var needCache = 'cache' in this.directives;
    var cacheDirective = this.directives['cache'];
    if (JSON && JSON.stringify && needCache) {
        if (!this.runCache) this.runCache = {};
        block.$cached = true;
        this.runCache[evalCacheKey(cacheDirective, block.__runParam)]  = block;
    }
};

return Mayo;
}  // end makeMayo

if (typeof module !== 'undefined' && module.exports) {
    var _  = require("under_score");
    module.exports = makeMayo(_);
}
else if (typeof define === 'function' && define.amd) {
    // in browser via require.js (AMD)
    define(['under_score'], function(_) {
        return makeMayo(_);
    });
}
else {
    root.mayo = makeMayo(root._);
}

}).call(this);
