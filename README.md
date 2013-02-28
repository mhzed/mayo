# mayo

Mayo is yet another generic template engine for javascript, key features include:

1. supports javascript as the template language
2. supports coffee-script as the template language
3. supports inheritance
4. supports embedding
5. fully asynchronous, including async call inside template
6. works in nodejs and in browser (requires jQuery in browser).  Supported browsers are chrome/firefox/safari/opera,
   and any other browsers based on webkit engine.  Internet Explorer has not been tested, but support is planned.
7. built-in caching for optimum run time performance.
8. uses a line based code marker, which makes template code easier to read(in author's opinion)

## Basics

A very basic usage example:

    var mayo = require("mayo");
    mayo.run("abc#{number}#{param.number}", {number: 4}, function(error, content) {
        // content is abc44
    } );

In the template, you may access the parameters directly or via the "param" parent object.

A more complex template:

    ==== ./test.html contains
    <h2>#{param.name}</h2>
    -- param.coordinates.forEach(function(c) {
    <div>#{c.x}</div><div>#{c.y}</div>
    -- });

    ==== code is
    mayo.run("./test.html", {
        name : "dots",
        coordinates : [ { x : 1, y: 2}, { x : 10, y: 20} ]
    }, function(err, content) {
        console.log(content);
    });

    ==== renders to
    <h2>plain</h2>
    <div>1</div><div>2</div>
    <div>10</div><div>20</div>

## Syntax

-- at the beginning of a line (preceding whitespaces are irrelevant) marks the line as code until the end of line (\n)
is reached.  Use #{..} in content to embed javascript expression.

-- on a line by itself marks the beginning/end of code block.  Example:

    --
      var x = 1;
      // more js code
    --

The template syntax is fully configurable via mayo.config object, default is:
{
    lineMarker    : '--',       // marker for single line code
    exprClosure   : '#{?}'      // marker for alternative embed expression, ? marks where the expression will be
    xcapeMarker   : '!'         // when inside of exprClosure, xml escape the value returned by expression using the
                                // mayo's implicitly provided 'xcape' function
    directiveCh   : '@',        // when proceeded by lineMarker marker, specifies a 'directive', see performance/cache
                                // section for example usage
};

To change any of the configuration, simply do:

    mayo.config.lineMarker = '==';
    // the changes will take effect globally after above line is executed

Regarding exprClosure: it gets converted to a RegExp, ? marks where the expression would be.  Expression must be a
one-liner, and in the default case, must not contain '}' as '}' marks the end of closure.  In case you want to render
\#{ to the output, then precede #{ with backslash \\.  The same backslash escape rule also applies to 'lineMarker',
examples:

    \--abc\#{'1'}
    ==== renders to
    --abc#{'1'}

    \\--abc
    ==== renders to
    \--abc

Regarding xcapeMarker, often you want the value to be escaped for xml/html before rendering to output, in such case
use xcapeMarker marker:

    #{!'<t>'}
    ==== renders to
    &lt;t&gt;

Note however

    #{ !'<t>'}
    ==== renders to
    false

! must follow #{ immediately to take effect, otherwise it becomes part of javascript expression as the negation
operator.

## Embedding

For reuse-ability, you can place a commonly used template block in a separate file, and then embed it in other
templates

    -- people.forEach(function(person) {
        ... template content ...
        -- _mayo.embed("./person.html", {person: person});
    -- });

_mayo is the implicit variable injected by template engine that refers to "this" template document.  If you use "this",
ensure you bind it to forEach, example:

    -- people.forEach(function(person) {
        ... template content ...
        -- this.embed("./person.html", {person: person});
    -- },this);

## Inheritance

An example first:

    ==== ./base.html
    <html>
    <head>
        -- _mayo.block("head");
    </head>
    <body>
        -- _mayo.block("body"));
    </body>
    </html>

    ==== ./child.html
    -- _mayo.extend("./base.html", {}, function() {
    --  _mayo.block("head", function() {
    <script></script>
    --  });  // end block "head"
    --  _mayo.block("body", function() {
    <div></div>
    --  });  // end block "body"
    ... garbage ....
    -- });  // end extend

    ==== output of child.html
    <html>
    <head>
    <script></script>
    </head>
    <body>
    <div></div>
    </body>
    </html>

"extend" is an async function that extends this template from a base template.  In the extended template, user
overrides the blocks that are defined in base template.  Note the text "... garbage ..." in child.html, because it's
outside of any overridden block definitions, the text is discarded and not rendered to the output.

* If you find above code extremely verbose and hard to read, consider using coffee-script, covered later.

child.html can further define more blocks inside "body" block

    ==== ./child.html
    -- _mayo.extend("./base.html", {}, function(err) {
    -- _mayo.block("head", function() {
    <script></script>
    -- });
    -- _mayo.block("body", function() {
    <div id="body">
    --
       _mayo.block("menu");
       _mayo.block("content");
    --
    </div>
    -- });  // end block "body"
    -- });

    ==== ./grandchild.html
    -- _mayo.extend("./child.html", {}, function(err) {
    -- _mayo.block("menu", function() {
      <div id='menu'/>
    -- });  // end block "menu"
    -- _mayo.block("content", function() {
      <div id='content'/>
    -- });  // end block "content"
    -- });  // end extend

    ==== ./grandchild.html renders to
    <html>
    <head>
    <script></script>
    </head>
    <body>
    <div id="body">
      <div id='menu'/>
      <div id='content'/>
    </div>
    </body>
    </html>

## Async call

Async call is supported in the template via "_mayo.async" call wrapper.

    ==== ./async.html
    <div>
    -- _mayo.async(null, setTimeout, function() {    // useless async for demo purpose
      <div id='async'/>
    -- }, 2000);
    </div>

    ==== renders to
    <div>
      <div id='async'/>
    </div>

Async calls can also be nested inside of each other.
* async wrapper looks for the actual callback in the argument list by scanning for function object from the back of
argument list.  For details see the api documentation below.

## Performance

Template code is compiled into javascript code before it's run.  Compiled javascript code (a function object, or a
nodejs module) is cached against resolved full path of the template file.

You may also cache the runtime result of a template file if it usually renders to the same output.  To cache
runtime result, you need to specify the caching directive in the template:

    ==== ./static.html
    --@(cache)
    <div id='staticContent'/>

"--@(cache)" tells template engine to cache the rendered result of this template.

Some templates take input parameters, and the rendered result varies depending on the input.

    ==== ./dynamic.html
    --@(cache : x+","+y)
    <div>#{x},#{y}</div>

    ==== ./other.html
    -- _mayo.embed("./dynamic.html", { x: 1 , y: 2});

"--@(cache : x+","+y)" tells mayo to cache rendered result against the string containing x and y seperated by ','.
You may specify any javascript expression after "cache : ", the returned value is obtained via "eval" and is used
directly as the key for caching result.

Be careful when caching dynamic pages where parameters that are very unique, as caching will take up memory that won't
be released until process is terminated. (run time garbage collection of cached results maybe added in the future)

## Nodejs

When running mayo inside nodejs, it offers a couple conveniences:

* You may use node's require inside template just as you would in a normal javascript file, example:


    -- var _ = require("underscore");
    -- var array = [1,2,3];
    -- _(array).chain().filter(function(x) { return x > 2; }.each(function(x) {
       .... #{x}....
    -- });

* If the javascript code in the template has syntax error, or failed during runtime, the error thrown would contain
   the line number at which error occurred.  This makes debugging much easier!

## Coffee-script

If you prefer to use coffee-script instead of javascript, ensure you add following line at the beginning of the file:

    --@(coffee)

This tells mayo that the language used inside this template file is coffee-script.

It goes without saying that you also must have 'coffee-script' installed in your run time environment.  For node, it
means that 'mayo.js' can successfully 'require("coffee-script")'.  For browser, the global var "coffee" must be set with
coffee-script engine.  Note by default, 'mayo' module does not depend on 'coffee-script', so installing
'mayo' via npm will not install 'coffee-script'.

Different template filess written in either javascript or coffee-script can freely reference each other (via "extend"
or "embed" calls) without any problems.

As indentation is part of coffee-script syntax, you need to be a bit careful about white spaces when using
coffee-script.  Consider this:

    --x = 1
      <pre>#{x}</pre>

Fails because second line is indented differently from the first line

The fix is:

    --x = 1; do=>
      <pre>#{x}</pre>

    ===== or

    --x = 1
    <pre>#{x}</pre>

Also consider this:

    --for x,y of coordinate
    <pre>#{x},#{y}</pre>

Fails because second line is of same indent as first line, so the 'for' body is empty

The fix is:

    --for x,y of coordinate
      <pre>#{x},#{y}</pre>

Under the hood, the resulting coffee-script code's actual indent is the amount of white spaces before first letter
of code:

    | marks begin of line
    |  --x=1        # indent is 2 spaces
    |--  x=1        # indent is 2 spaces
    | -- x=1        # indent is 2 spaces

For template content, it gets converted to coffee-script code with same indent level of the content itself

    |<x>            # indent is 0 space
    | <x>           # indent is 1 space
    |  <x>          # indent is 2 spaces, and so on...

The main advantage of using "coffee-script" is that template code becomes a lot less verbose and readable, consider:

    // javascript
    --if (condition) {
    --  for (var k in obj) {
    --    func(obj[k], function(result) {
            output #{result}
    --    });
    --  }
    --}

    ## coffee-script equivalent
    --if condition
      --for k,v of obj
        --func v, (result)=>
            output #{result}

    ===== or

    --this.extend("./base.html", {}, function(err) {
        -- this.extendBlock("menu", function() {
            ...
        -- });
    --});

    # coffee-script equivalent

    --@extend "./base.html", {}, (err)=>
        --@extendBlock "menu", =>
            ....

The main dis-advantage of using 'coffee-script' is that run-time error will report line number in the compiled
java-script code, instead of line number in original coffee-script source code, this can make debugging painful.
However in reality, this is not a as big a problem as it looks, as long as you:

    * Test often, and write unit tests
    * Template should contain only 'view' related code logic and nothing else

## Synchronous run

To run mayo synchronously, mainly for convenience, use "mayo.runSync".  Example:

    mayo.runSync("abc#{x}", {x:1}); // returns "abc4"

"runSync" has a few limitations:

    * no async call supported in template code, for obvious reason
    * no cache optimization, every runSync go through the process of: parsing-compilation->run

## Advanced Syntax

"marble" is a derivation of mayo that employs an indentation based syntax and coffee-script that results in much
less verbose and cleaner code.  It's ideal for generating xml/html or any other types of text document.

## Main Api

* [run](#run)
* [runSync](#runSync)
* [runUrl](#runUrl)
* [clearCache](#clearCache)

<a name="run" />
### run(templateStr, param, cb)

Asynchronously run templateContent with param applied.

__Arguments__

* templateStr - A string containing the template content.
* param - A object containing parameters to pass to template.
* cb(err, content) - A callback which is called after template is rendered or an error has occurred. See runUrl for
  more details.

__Example__

    mayo.run("abc#{number}", {number: 4}, function(error, content) {
        // content is "abc4"
    } );

---------------------------------------

<a name="runSync" />
### runSync(templateContent, param)

Synchronously run templateContent with param applied.

__Arguments__

* templateContent - A string containing the template content.
* param - A object containing parameters to pass to template.
* returns - rendered output

__Example__

    mayo.runSync("abc#{number}", {number: 4});  // returns "abc4"

---------------------------------------

<a name="runUrl" />
### runUrl(templateUrl, param, cb)

Run template at specified url with param applied.  The compiled template runtime is cached against fully resolved url
the first time it's encountered.

__Arguments__

* templateUrl - The url of template file.  If you specify a relative path, then on server it's resolved against current
  path (process.cwd), on browser it's resolved against location of current page.
* param - A object containing parameters to pass to template.
* cb(err, content) - A callback which is called after template is rendered or an error has occurred. 'err' maybe an
  array if more than one async error encountered (see async documentation).  'content' will still contain text if
  'err' is async errors.  Therefore, use 'if (content)' instead of 'if (!err)' to determine where there is rendered
  output.

__Example__

    mayo.runUrl("./path/to/template.html", {number: 4}, function(error, content) {
    } );

---------------------------------------

<a name="clearCache" />
### clearCache()

Clear all cached parsed template objects and rendered results.

## Runtime api ( to be called inside the template code )

Runtime api refers to the functions that you can call inside the template.  In the template, the runtime object
is referenced by "this" or "_mayo".

* [print](#print)
* [block](#block)
* [filter](#filter)
* [insertSuper](#insertSuper)
* [extendBlock](#extendBlock)
* [extend](#extend)
* [embed](#embed)
* [async](#async)

<a name="print" />
### print(content)

Print content into rendered result.  Useful when you need to directly render to result inside code.

__Example__

    -- _mayo.print("abc\n");
    ===== is equivalent of ===
    abc

__Arguments__

* content - the content to print
* returns this
---------------------------------------

<a name="block" />
### block(name, bodyCb)

Defines or overrides a block with specified name in this template.  Block is the main mechanism that enables
inheritance, allowing derived template to override blocks defined in parent template.

__Arguments__

* name - name of the block to define.
* bodyCb - callback function, optional, if provided, defines the body of this block
* returns this

---------------------------------------

<a name="filter" />
### filter(filterCb, bodyCb)

Install a filter function to filter the template content defined in "cb".

Caveat: filter function is applied at render time, meaning it bypasses the runtime cache, and is run every time
regardless if runtime cache is turned on in the template.

__Arguments__

* filterCb(content) - the filter callback, must return filtered content
* bodyCb - callback function defining body to be filtered, optional
* returns this

__Example__

    -- this.filter(xcape, function(){
      <a>
    -- });
    ===== renders to =====
      &lt;a&gt;

* Note:  'xcape' is a xml/html escape function implicitly provided by mayo.

---------------------------------------

<a name="insertSuper" />
### insertSuper()

Only valid inside "bodyCb" of "block" call.  Insert parent block's content at current location.

__Arguments__

* returns this

---------------------------------------

<a name="extendBlock" />
### extendBlock(name, bodyCb)

Alias for `block(name, function() { _mayo.insertSuper(); `.

__Arguments__

* name - name of block to extend
* bodyCb - defines extra block content
* returns this

---------------------------------------

<a name="extend" />
### extend(template, param, callback)

Extends/Inherits from another template.

__Arguments__

* template - could be another template object, or a url pointing to the template file
* param - optional, the parameter object to pass to template
* callback(err) - async callback is called after extend completes. 'err' maybe an array object, see 'async'
  documentation for details.
* returns this

__Example__

    -- this.extend("./base.html", { x : 2 }, function(err) {
    --     this.block("base", function() {
           ... overridden base block content here ....
    --     });
    -- });


---------------------------------------

<a name="embed" />
### embed(template, param, indentStr, callback)

Embed another template's content at current location.

__Arguments__

* template - could be another template object, or a url pointing to the template file
* param - optional, the parameter object to pass to template
* indentStr - optional, insert indentStr to beginning of each line in embedded content, ensure output's 'prettiness'
* callback(err) - async callback is called after embed completes, optional.  'err' maybe an array object, see 'async'
  documentation for details.
* returns this

__Example__

    -- this.embed("./component.html", { x : 1 }, function (err) {
    --    if (err) ... error handling here ....
    -- });

The rendering of current template will continue normally regardless if embed's async callback has received an error

---------------------------------------

<a name="async" />
### async (thisObj, callFunc, /*...*/)

Perform a async call inside a template.

The error passed to the actual async call back of 'callFunc' (error is always the first parameter, per js convention)
is saved under this template's run time.  The error will not interrupt this template run time, execution continues
normally.  The saved errors are eventually passed to 'run' or 'runUrl' callbacks.  Hence, if there are multiple async
calls, then the error object that's passed to the 'run*' callbacks maybe an array when multiple errors are encountered.
Moreover, 'embed' and 'extend' are implemented using 'async', so same rule applies to those functions as well.
Sublimely, this means that the error object passed to 'embed' and 'extend' callbacks may also be an array, as the target
template must be run before they can be embedded or extended.

Async call can be nested inside another async call.

__Arguments__

* thisObj - optional, 'this' object to bind to callFunc
* callFunc - the async function to be called
* ... - the arguments to pass to callFunc, the async callback of callFunc is determined by scanning for function
        object starting from the back of argument list.  Error is thrown if no callback function object is found.
* returns this

__Example__

    -- this.async(setTimeout, function() {
        ... template content ...
    -- }, 2000);
