var url = require("url"),
    path = require("path"),  
    fs = require("fs"),
    mayo = require('../lib/mayo'),
    assert = require('assert');

module.exports["runsync tests"] = function(test) {
    test.equal(mayo.runSync("abc#{number}", {number: 4}), "abc4\n", "sync run");
    test.equal(mayo.runSync("--@(coffee)\nabc#{number}", {number: 4}), "abc4\n", "sync run coffee");
    try {
        mayo.runSync("--this.async(null, setTimeout, function(){}, 0);", {});
        test.ok(false, "exception expected when async call is found in runSync");
    } catch (e) {
    }
    test.done();
};

module.exports["mayo basic run tests"] = function(test) {

    mayo.run("abc#{number}", {number: 4}, function(err, content) {
        test.ifError(err);
        test.equal(content, "abc4\n", "embed number");
    });

    mayo.run("\\--abc\\#{'1'}", {}, function(err, content) {
        test.ifError(err);
        test.equal(content, "--abc#{'1'}\n", "Test basic Mayo.run with escape");
    });
    mayo.run("#{ !'<t>'}", {}, function(err, content) {
        test.ifError(err);
        test.equal(content, "false\n", "Test basic Mayo.run with invalid xcape");
    });
    mayo.run("\\\\--abc\\\\#{'1'}", {}, function(err, content) {
        test.ifError(err);
        test.equal(content, "\\--abc\\#{'1'}\n", "Test basic Mayo.run with escape");
    });

    mayo.run("abc#{!param.xml}", {xml: "<t>"}, function(err, content) {
        test.ifError(err);
        test.equal(content, "abc&lt;t&gt;\n", "Test basic Mayo.run with xcape");
    });

    mayo.run("abc#{param.xml}", {xml: "<t>"}, function(err, content) {
        test.ifError(err);
        test.equal(content, "abc<t>\n", "Test basic Mayo.run with no xcape");
    });
    mayo.run("--@(cache)\nabc#{param.number}", {number: 4}, function(err, content) {
        test.ifError(err);
        test.equal(content, "abc4\n", "Test basic Mayo.run with directive");
    });
    mayo.run("--@(cache:)\n'../#{param.number}'", {number: 4}, function(err, content) {
        test.ifError(err);
        test.equal(content, "'../4'\n", "Test basic Mayo.run with '../ ");
    });	
    mayo.run("--@(cache: 1)\n'../\\\\#{param.number}'", {number: 4}, function(err, content) {
        test.ifError(err);
        test.equal(content, "'../\\#{param.number}'\n", "Test basic Mayo.run with escape on expr");
    });
    mayo.run("--@(cache 1)\n'../\\\\#{param.number}'", {number: 4}, function(err, content) {
        test.ok(err);   // expects error due to invalid directive
    });

    mayo.run("\\\\--@(cache: 1)", {number: 4}, function(err, content) {
        test.ifError(err);
        test.equal(content, "\\--@(cache: 1)\n", "Test basic Mayo.run with escape on code");
    });		

    mayo.run("--@(coffee)\n--a=number\n#{a}", {number: 4}, function(err, content) {
        test.ifError(err);
        test.equal(content, "4\n", "Test basic coffee script");
    });

    mayo.run(
        "--@(coffee)\n" +
        "--if true\n" +
        "  yes\n" +
        "    #{'a'}"
        , {coordinates: [{x:1,y:1}, {x:2,y:2}, {x:3,y:3} ] }, function(err, content) {
        test.ifError(err);
        test.equal(content, "  yes\n    a\n", "Test basic coffee script with indent");
    });
    mayo.run(
        "--@(coffee)\n" +
        "--if true\n" +
        "  yes\n" +
        "  --this.print('b')"
        , {coordinates: [{x:1,y:1}, {x:2,y:2}, {x:3,y:3} ] }, function(err, content) {
        test.ifError(err);
        test.equal(content, "  yes\nb", "Test basic coffee script with indent");
    });
    mayo.run(
        "--@(coffee)\n" +
        "head\n"+
        "--if true\n" +
        "  yes#{'a'}\n" +
        "  --for c in coordinates\n" +
        "    #{c.x}\n"+
        "  done"
        , {coordinates: [{x:1,y:1}, {x:2,y:2}, {x:3,y:3} ] }, function(err, content) {
        test.ifError(err);
        test.equal(content, "head\n  yesa\n    1\n    2\n    3\n  done\n", "Test basic coffee script with indent");
        test.done();
    });
};

module.exports["run url test"] = function(test) {
    mayo.runUrl(path.join(__dirname, "data/embed.txt"), {}, function(err, content) {
        test.ifError(err);
        test.equal(/#{}/m.test(content), true, "escapped embed expr");
        test.equal(/embedded content 0/m.test(content), true, "Test basic Mayo.run with loop");
        test.equal(/embedded content 1/m.test(content), true, "Test basic Mayo.run with loop");
        test.done();
    });
};
module.exports["loop embed"] = function(test) {
    mayo.runUrl(path.join(__dirname, "data/embed_loop.txt"), {}, function(err, content) {
        test.ifError(err);
        test.equal(/embedded content 0/m.test(content), true);
        test.equal(/embedded content 1/m.test(content), true);
        test.equal(/embedded content 2/m.test(content), true);
        test.equal(/embedded content 3/m.test(content), true);
        test.done();
    });
};
module.exports["embed/filter/block"] = function(test) {
    mayo.runUrl(path.join(__dirname, 'data/Mayo.txt'), {
        px : 1,
        ps : 'param string'
    }, function(err, content) {
        test.ifError(err);

        test.equal(/embedded content 0/m.test(content), true, "Verify embedding");
        test.equal(/embedded content 1/m.test(content), true, "Verify embedding");

        test.equal(/abc---/m.test(content), true, "Verify filtering");
        test.equal(/---xyz/m.test(content), true, "Verify filtering");

        test.equal(/o o o o o o/m.test(content), true, "Verify block");
        test.equal(/o x o x o x/m.test(content), true, "Verify block");
        test.done();
    });
};

module.exports["extend"] = function(test) {
    mayo.runUrl(path.join(__dirname, 'data/MayoDerived.txt'), {
        px : 1,
        ps : 'param string'
    }, function(err, content) {
        test.ifError(err);

        test.equal(/the template test txt file/m.test(content), true, "Verify one level extending");    // content on Mayo.txt is still here

        test.equal(/embedded content 0/m.test(content), true, "Verify base template embed another file");    // content on Mayo.txt is still here
        test.equal(/embedded content 1/m.test(content), true, "Verify base template embed another file");

        test.equal(/o o o o o o/m.test(content), false, "Verify block override");
        test.equal(/. . . . . ./m.test(content), true, "Verify block override");

        test.equal(/tmodule/m.test(content), true, "Verify require");
        test.done();
    });
};

module.exports["extend blocks"] = function(test) {
    mayo.runUrl(path.join(__dirname, 'data/MayoDerivedExtendBlock.txt'), {
        px : 1,
        ps : 'param string'
    }, function(err, content) {
        test.ifError(err);

        test.equal(/o o o o o o/m.test(content), true, "Verify block extension");
        test.equal(/. . . . . ./m.test(content), true, "Verify block extension");

        test.equal(/embed begin/m.test(content), true, "Verify embed extended content");
        test.equal(/embedded content 10/m.test(content), true, "Verify embed extended content");
        test.equal(/embedded content 11/m.test(content), true, "Verify embed extended content");
        test.done();

    });
};
module.exports["multi-level extend"] = function(test) {
    mayo.runUrl(path.join(__dirname, 'data/MayoGrandChild.txt'), {
        px : 1,
        ps : 'param string'
    }, function(err, content) {
        test.ifError(err);
        test.equal(/embedded content 0/m.test(content), true, "Verify two level extending");    // content on Mayo.txt is still here
        test.equal(/embedded content 1/m.test(content), true, "Verify two level extending");

        test.equal(/o o o o o o/m.test(content), false, "Verify block override");          // ensure old block content is gone
        test.equal(/. . . . . ./m.test(content), false, "Verify block override");
        test.equal(/ grand child /m.test(content), true, "Verify block override");
        test.done();

    });
};
module.exports["nested async"] = function(test) {

    mayo.runUrl(path.join(__dirname, 'data/MayoNestAsync.txt'), {
        px : 1,
        ps : 'param string'
    }, function(err, content) {
        test.ifError(err);

        test.equal(/. . . . . ./m.test(content), false, "Verify block override");
        test.equal(/ async /m.test(content), true, "async");
        test.equal(/ nested async /m.test(content), true, "nested async");
        test.done();
    });
};
module.exports["embed error"] = function(test) {

    mayo.runUrl(path.join(__dirname, 'data/embed_error.txt'), {
    }, function(err, content) {
        // err is expected
        //if (err) console.log(err);
        test.equal(err.length, 2, "Verify embed error");    // there are two embed error, should be queued here
        test.equal(/error is : /m.test(content), true, "Verify embed error");
        test.equal(/nofile/m.test(content), true, "Verify embed error");
        test.done();

    });

};

//    mayo.runUrl(path.join(__dirname, 'data/err/coffee_err_syntax.txt'), {
//    }, function(err, content) {
//         if (err) console.log(err.stack);
//    });
