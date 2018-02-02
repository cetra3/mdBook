// Fix back button cache problem
window.onunload = function () { };

// Global variable, shared between modules
function playpen_text(playpen) {
    let code_block = playpen.querySelector("code");

    if (window.ace && code_block.classList.contains("editable")) {
        let editor = window.ace.edit(code_block);
        return editor.getValue();
    } else {
        return code_block.textContent;
    }
}

(function codeSnippets() {
    // Hide Rust code lines prepended with a specific character
    var hiding_character = "#";
    var request = fetch("https://play.rust-lang.org/meta/crates", {
        headers: {
            'Content-Type': "application/json",
        },
        method: 'POST',
        mode: 'cors',
    });

    function handle_crate_list_update(playpen_block, playground_crates) {
        // update the play buttons after receiving the response
        update_play_button(playpen_block, playground_crates);

        // and install on change listener to dynamically update ACE editors
        if (window.ace) {
            let code_block = playpen_block.querySelector("code");
            if (code_block.classList.contains("editable")) {
                let editor = window.ace.edit(code_block);
                editor.addEventListener("change", function (e) {
                    update_play_button(playpen_block, playground_crates);
                });
            }
        }
    }

    // updates the visibility of play button based on `no_run` class and
    // used crates vs ones available on http://play.rust-lang.org
    function update_play_button(pre_block, playground_crates) {
        var play_button = pre_block.querySelector(".play-button");

        // skip if code is `no_run`
        if (pre_block.querySelector('code').classList.contains("no_run")) {
            play_button.classList.add("hidden");
            return;
        }

        // get list of `extern crate`'s from snippet
        var txt = playpen_text(pre_block);
        var re = /extern\s+crate\s+([a-zA-Z_0-9]+)\s*;/g;
        var snippet_crates = [];
        while (item = re.exec(txt)) {
            snippet_crates.push(item[1]);
        }

        // check if all used crates are available on play.rust-lang.org
        var all_available = snippet_crates.every(function (elem) {
            return playground_crates.indexOf(elem) > -1;
        });

        if (all_available) {
            play_button.classList.remove("hidden");
        } else {
            play_button.classList.add("hidden");
        }
    }

    function run_rust_code(code_block) {
        var result_block = code_block.querySelector(".result");
        if (!result_block) {
            result_block = document.createElement('code');
            result_block.className = 'result hljs language-bash';

            code_block.append(result_block);
        }

        let text = playpen_text(code_block);

        var params = {
            channel: "stable",
            mode: "debug",
            crateType: "bin",
            tests: false,
            code: text,
        }

        if (text.indexOf("#![feature") !== -1) {
            params.channel = "nightly";
        }

        result_block.innerText = "Running...";

        var request = fetch("https://play.rust-lang.org/execute", {
            headers: {
                'Content-Type': "application/json",
            },
            method: 'POST',
            mode: 'cors',
            body: JSON.stringify(params)
        });

        request
            .then(function (response) { return response.json(); })
            .then(function (response) { result_block.innerText = response.success ? response.stdout : response.stderr; })
            .catch(function (error) { result_block.innerText = "Playground communication" + error.message; });
    }

    // Syntax highlighting Configuration
    hljs.configure({
        tabReplace: '    ', // 4 spaces
        languages: [],      // Languages used for auto-detection
    });

    if (window.ace) {
        // language-rust class needs to be removed for editable
        // blocks or highlightjs will capture events
        Array
            .from(document.querySelectorAll('code.editable'))
            .forEach(function (block) { block.classList.remove('language-rust'); });

        Array
            .from(document.querySelectorAll('code:not(.editable)'))
            .forEach(function (block) { hljs.highlightBlock(block); });
    } else {
        Array
            .from(document.querySelectorAll('code'))
            .forEach(function (block) { hljs.highlightBlock(block); });
    }

    // Adding the hljs class gives code blocks the color css
    // even if highlighting doesn't apply
    Array
        .from(document.querySelectorAll('code'))
        .forEach(function (block) { block.classList.add('hljs'); });

    Array.from(document.querySelectorAll("code.language-rust")).forEach(function (block) {

        var code_block = block;
        var pre_block = block.parentNode;
        // hide lines
        var lines = code_block.innerHTML.split("\n");
        var first_non_hidden_line = false;
        var lines_hidden = false;

        for (var n = 0; n < lines.length; n++) {
            if (lines[n].trim()[0] == hiding_character) {
                if (first_non_hidden_line) {
                    lines[n] = "<span class=\"hidden\">" + "\n" + lines[n].replace(/(\s*)# ?/, "$1") + "</span>";
                }
                else {
                    lines[n] = "<span class=\"hidden\">" + lines[n].replace(/(\s*)# ?/, "$1") + "\n" + "</span>";
                }
                lines_hidden = true;
            }
            else if (first_non_hidden_line) {
                lines[n] = "\n" + lines[n];
            }
            else {
                first_non_hidden_line = true;
            }
        }
        code_block.innerHTML = lines.join("");

        // If no lines were hidden, return
        if (!lines_hidden) { return; }

        var buttons = document.createElement('div');
        buttons.className = 'buttons';
        buttons.innerHTML = "<button class=\"fa fa-expand\" title=\"Show hidden lines\" aria-label=\"Show hidden lines\"></button>";

        // add expand button
        pre_block.prepend(buttons);

        pre_block.querySelector('.buttons').addEventListener('click', function (e) {
            if (e.target.classList.contains('fa-expand')) {
                var lines = pre_block.querySelectorAll('span.hidden');

                e.target.classList.remove('fa-expand');
                e.target.classList.add('fa-compress');
                e.target.title = 'Hide lines';
                e.target.setAttribute('aria-label', e.target.title);

                Array.from(lines).forEach(function (line) {
                    line.classList.remove('hidden');
                    line.classList.add('unhidden');
                });
            } else if (e.target.classList.contains('fa-compress')) {
                var lines = pre_block.querySelectorAll('span.unhidden');

                e.target.classList.remove('fa-compress');
                e.target.classList.add('fa-expand');
                e.target.title = 'Show hidden lines';
                e.target.setAttribute('aria-label', e.target.title);

                Array.from(lines).forEach(function (line) {
                    line.classList.remove('unhidden');
                    line.classList.add('hidden');
                });
            }
        });
    });

    Array.from(document.querySelectorAll('pre code')).forEach(function (block) {
        var pre_block = block.parentNode;
        if (!pre_block.classList.contains('playpen')) {
            var buttons = pre_block.querySelector(".buttons");
            if (!buttons) {
                buttons = document.createElement('div');
                buttons.className = 'buttons';
                pre_block.prepend(buttons);
            }

            var clipButton = document.createElement('button');
            clipButton.className = 'fa fa-copy clip-button';
            clipButton.title = 'Copy to clipboard';
            clipButton.setAttribute('aria-label', clipButton.title);
            clipButton.innerHTML = '<i class=\"tooltiptext\"></i>';

            buttons.prepend(clipButton);
        }
    });

    // Process playpen code blocks
    Array.from(document.querySelectorAll(".playpen")).forEach(function (pre_block) {
        // Add play button
        var buttons = pre_block.querySelector(".buttons");
        if (!buttons) {
            buttons = document.createElement('div');
            buttons.className = 'buttons';
            pre_block.prepend(buttons);
        }

        var runCodeButton = document.createElement('button');
        runCodeButton.className = 'fa fa-play play-button';
        runCodeButton.hidden = true;
        runCodeButton.title = 'Run this code';
        runCodeButton.setAttribute('aria-label', runCodeButton.title);

        var copyCodeClipboardButton = document.createElement('button');
        copyCodeClipboardButton.className = 'fa fa-copy clip-button';
        copyCodeClipboardButton.innerHTML = '<i class="tooltiptext"></i>';
        copyCodeClipboardButton.title = 'Copy to clipboard';
        copyCodeClipboardButton.setAttribute('aria-label', copyCodeClipboardButton.title);

        buttons.prepend(runCodeButton);
        buttons.prepend(copyCodeClipboardButton);

        runCodeButton.addEventListener('click', function (e) {
            run_rust_code(pre_block);
        });

        let code_block = pre_block.querySelector("code");
        if (window.ace && code_block.classList.contains("editable")) {
            var undoChangesButton = document.createElement('button');
            undoChangesButton.className = 'fa fa-history reset-button';
            undoChangesButton.title = 'Undo changes';
            undoChangesButton.setAttribute('aria-label', undoChangesButton.title);

            buttons.prepend(undoChangesButton);

            undoChangesButton.addEventListener('click', function () {
                let editor = window.ace.edit(code_block);
                editor.setValue(editor.originalCode);
                editor.clearSelection();
            });
        }
    });

    request
        .then(function (response) { return response.json(); })
        .then(function (response) {
            // get list of crates available in the rust playground
            let playground_crates = response.crates.map(function (item) { return item["id"]; });
            Array.from(document.querySelectorAll(".playpen")).forEach(function (block) {
                handle_crate_list_update(block, playground_crates);
            });
        });

})();

(function themes() {
    var html = document.querySelector('html');
    var themeToggleButton = document.getElementById('theme-toggle');
    var themePopup = document.getElementById('theme-list');
    var themeColorMetaTag = document.querySelector('meta[name="theme-color"]');
    var stylesheets = {
        ayuHighlight: document.querySelector("[href$='ayu-highlight.css']"),
        tomorrowNight: document.querySelector("[href$='tomorrow-night.css']"),
        highlight: document.querySelector("[href$='highlight.css']"),
    };

    function showThemes() {
        themePopup.style.display = 'block';
        themeToggleButton.setAttribute('aria-expanded', true);
    }

    function hideThemes() {
        themePopup.style.display = 'none';
        themeToggleButton.setAttribute('aria-expanded', false);
    }

    function set_theme(theme) {
        let ace_theme;

        if (theme == 'coal' || theme == 'navy') {
            stylesheets.ayuHighlight.disabled = true;
            stylesheets.tomorrowNight.disabled = false;
            stylesheets.highlight.disabled = true;

            ace_theme = "ace/theme/tomorrow_night";
        } else if (theme == 'ayu') {
            stylesheets.ayuHighlight.disabled = false;
            stylesheets.tomorrowNight.disabled = true;
            stylesheets.highlight.disabled = true;

            ace_theme = "ace/theme/tomorrow_night";
        } else {
            stylesheets.ayuHighlight.disabled = true;
            stylesheets.tomorrowNight.disabled = true;
            stylesheets.highlight.disabled = false;

            ace_theme = "ace/theme/dawn";
        }

        setTimeout(function () {
            themeColorMetaTag.content = getComputedStyle(document.body).backgroundColor;
        }, 1);

        if (window.ace && window.editors) {
            window.editors.forEach(function (editor) {
                editor.setTheme(ace_theme);
            });
        }

        var previousTheme;
        try { previousTheme = localStorage.getItem('mdbook-theme'); } catch (e) { }
        if (previousTheme === null || previousTheme === undefined) { previousTheme = 'light'; }

        try { localStorage.setItem('mdbook-theme', theme); } catch (e) { }

        document.body.className = theme;
        html.classList.remove(previousTheme);
        html.classList.add(theme);
    }

    // Set theme
    var theme;
    try { theme = localStorage.getItem('mdbook-theme'); } catch(e) { }
    if (theme === null || theme === undefined) { theme = 'light'; }

    set_theme(theme);

    themeToggleButton.addEventListener('click', function () {
        if (themePopup.style.display === 'block') {
            hideThemes();
        } else {
            showThemes();
        }
    });

    themePopup.addEventListener('click', function (e) {
        var theme = e.target.id || e.target.parentElement.id;
        set_theme(theme);
    });

    // Hide theme selector popup when clicking outside of it
    document.addEventListener('click', function (event) {
        if (themePopup.style.display === 'block' && !themeToggleButton.contains(event.target) && !themePopup.contains(event.target)) {
            hideThemes();
        }
    });

    document.addEventListener('keydown', function (e) {
        switch (e.key) {
            case 'Escape':
                e.preventDefault();
                hideThemes();
                break;
        }
    });
})();

(function sidebar() {
    var html = document.querySelector("html");
    var sidebar = document.getElementById("sidebar");
    var sidebarLinks = document.querySelectorAll('#sidebar a');
    var sidebarToggleButton = document.getElementById("sidebar-toggle");
    var firstContact = null;

    function showSidebar() {
        html.classList.remove('sidebar-hidden')
        html.classList.add('sidebar-visible');
        Array.from(sidebarLinks).forEach(function (link) {
            link.setAttribute('tabIndex', 0);
        });
        sidebarToggleButton.setAttribute('aria-expanded', true);
        sidebar.setAttribute('aria-hidden', false);
        try { localStorage.setItem('mdbook-sidebar', 'visible'); } catch (e) { }
    }

    function hideSidebar() {
        html.classList.remove('sidebar-visible')
        html.classList.add('sidebar-hidden');
        Array.from(sidebarLinks).forEach(function (link) {
            link.setAttribute('tabIndex', -1);
        });
        sidebarToggleButton.setAttribute('aria-expanded', false);
        sidebar.setAttribute('aria-hidden', true);
        try { localStorage.setItem('mdbook-sidebar', 'hidden'); } catch (e) { }
    }

    // Toggle sidebar
    sidebarToggleButton.addEventListener('click', function sidebarToggle() {
        if (html.classList.contains("sidebar-hidden")) {
            showSidebar();
        } else if (html.classList.contains("sidebar-visible")) {
            hideSidebar();
        } else {
            if (getComputedStyle(sidebar)['transform'] === 'none') {
                hideSidebar();
            } else {
                showSidebar();
            }
        }
    });

    document.addEventListener('touchstart', function (e) {
        firstContact = {
            x: e.touches[0].clientX,
            time: Date.now()
        };
    }, { passive: true });

    document.addEventListener('touchmove', function (e) {
        if (!firstContact)
            return;

        var curX = e.touches[0].clientX;
        var xDiff = curX - firstContact.x,
            tDiff = Date.now() - firstContact.time;

        if (tDiff < 250 && Math.abs(xDiff) >= 150) {
            if (xDiff >= 0 && firstContact.x < Math.min(document.body.clientWidth * 0.25, 300))
                showSidebar();
            else if (xDiff < 0 && curX < 300)
                hideSidebar();

            firstContact = null;
        }
    }, { passive: true });

    // Scroll sidebar to current active section
    var activeSection = sidebar.querySelector(".active");
    if (activeSection) {
        sidebar.scrollTop = activeSection.offsetTop;
    }
})();

(function chapterNavigation() {
    document.addEventListener('keydown', function (e) {
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) { return; }
        if (search && search.hasFocus()) { return; }

        switch (e.key) {
            case 'ArrowRight':
                e.preventDefault();
                var nextButton = document.querySelector('.nav-chapters.next');
                if (nextButton) {
                    window.location.href = nextButton.href;
                }
                break;
            case 'ArrowLeft':
                e.preventDefault();
                var previousButton = document.querySelector('.nav-chapters.previous');
                if (previousButton) {
                    window.location.href = previousButton.href;
                }
                break;
        }
    });
})();

(function clipboard() {
    var clipButtons = document.querySelectorAll('.clip-button');

    function hideTooltip(elem) {
        elem.firstChild.innerText = "";
        elem.className = 'fa fa-copy clip-button';
    }

    function showTooltip(elem, msg) {
        elem.firstChild.innerText = msg;
        elem.className = 'fa fa-copy tooltipped';
    }

    var clipboardSnippets = new Clipboard('.clip-button', {
        text: function (trigger) {
            hideTooltip(trigger);
            let playpen = trigger.closest("pre");
            return playpen_text(playpen);
        }
    });

    Array.from(clipButtons).forEach(function (clipButton) {
        clipButton.addEventListener('mouseout', function (e) {
            hideTooltip(e.currentTarget);
        });
    });

    clipboardSnippets.on('success', function (e) {
        e.clearSelection();
        showTooltip(e.trigger, "Copied!");
    });

    clipboardSnippets.on('error', function (e) {
        showTooltip(e.trigger, "Clipboard error!");
    });
})();

(function autoHideMenu() {
    var menu = document.getElementById('menu-bar');

    var previousScrollTop = document.scrollingElement.scrollTop;

    document.addEventListener('scroll', function () {
        if (menu.classList.contains('folded') && document.scrollingElement.scrollTop < previousScrollTop) {
            menu.classList.remove('folded');
        } else if (!menu.classList.contains('folded') && document.scrollingElement.scrollTop > previousScrollTop) {
            menu.classList.add('folded');
        }

        if (!menu.classList.contains('bordered') && document.scrollingElement.scrollTop > 0) {
            menu.classList.add('bordered');
        }

        if (menu.classList.contains('bordered') && document.scrollingElement.scrollTop === 0) {
            menu.classList.remove('bordered');
        }

        previousScrollTop = document.scrollingElement.scrollTop;
    }, { passive: true });
})();

var search = (function search() {
    // Search functionality
    //
    // Usage: call init() on startup. You can use !hasFocus() to prevent keyhandling in your key
    // event handlers while the user is typing his search.
    
    var searchbar = document.getElementById('searchbar'),
        searchbar_outer = document.getElementById('searchbar-outer'),
        searchresults = document.getElementById('searchresults'),
        searchresults_outer = document.getElementById('searchresults-outer'),
        searchresults_header = document.getElementById('searchresults-header'),
        searchicon = document.getElementById('search-toggle'),
        content = document.getElementById('content'),
        menu_title = document.getElementById('menu-title'),

        searchindex = null,
        searchoptions = {
            bool: "AND",
            expand: true,
            teaser_word_count: 30,
            limit_results: 30,
            fields: {
                title: {boost: 1},
                body: {boost: 1},
                breadcrumbs: {boost: 0}
            }
        },
        mark_exclude = [],
        marker = new Mark(content),
        current_searchterm = "",
        URL_SEARCH_PARAM = 'search',
        URL_MARK_PARAM = 'highlight',

        SEARCH_HOTKEY_KEYCODE = 83,
        ESCAPE_KEYCODE = 27,
        DOWN_KEYCODE = 40,
        UP_KEYCODE = 38,
        SELECT_KEYCODE = 13;

    function hasFocus() {
        return searchbar === document.activeElement;
    }

    function removeChildren(elem) {
        while (elem.firstChild) {
            elem.removeChild(elem.firstChild);
        }
    }

    // Helper to parse a url into its building blocks.
    function parseURL(url) {
        var a =  document.createElement('a');
        a.href = url;
        return {
            source: url,
            protocol: a.protocol.replace(':',''),
            host: a.hostname,
            port: a.port,
            params: (function(){
                var ret = {};
                var seg = a.search.replace(/^\?/,'').split('&');
                var len = seg.length, i = 0, s;
                for (;i<len;i++) {
                    if (!seg[i]) { continue; }
                    s = seg[i].split('=');
                    ret[s[0]] = s[1];
                }
                return ret;
            })(),
            file: (a.pathname.match(/\/([^/?#]+)$/i) || [,''])[1],
            hash: a.hash.replace('#',''),
            path: a.pathname.replace(/^([^/])/,'/$1')
        };
    }
    
    // Helper to recreate a url string from its building blocks.
    function renderURL(urlobject) {
        var url = urlobject.protocol + "://" + urlobject.host;
        if (urlobject.port != "") {
            url += ":" + urlobject.port;
        }
        url += urlobject.path;
        var joiner = "?";
        for(var prop in urlobject.params) {
            if(urlobject.params.hasOwnProperty(prop)) {
                url += joiner + prop + "=" + urlobject.params[prop];
                joiner = "&";
            }
        }
        if (urlobject.hash != "") {
            url += "#" + urlobject.hash;
        }
        return url;
    }
    
    // Helper to escape html special chars for displaying the teasers
    var escapeHTML = (function() {
        var MAP = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&#34;',
            "'": '&#39;'
        };
        var repl = function(c) { return MAP[c]; };
        return function(s) {
            return s.replace(/[&<>'"]/g, repl);
        };
    })();
    
    function formatSearchMetric(count, searchterm) {
        if (count == 1) {
            return count + " search result for '" + searchterm + "':";
        } else if (count == 0) {
            return "No search results for '" + searchterm + "'.";
        } else {
            return count + " search results for '" + searchterm + "':";
        }
    }
    
    function formatSearchResult(result, searchterms) {
        var teaser = makeTeaser(escapeHTML(result.doc.body), searchterms);

        // The ?URL_MARK_PARAM= parameter belongs inbetween the page and the #heading-anchor
        var url = result.ref.split("#");
        if (url.length == 1) { // no anchor found
            url.push("");
        }

        console.log(path_to_root);

        return '<a href="'
                + path_to_root
                + url[0] + '?' + URL_MARK_PARAM + '=' + searchterms + '#' + url[1]
                + '">' + result.doc.breadcrumbs + '</a>' // doc.title
                + '<span class="breadcrumbs">' + '</span>'
                + '<span class="teaser">' + teaser + '</span>';
    }
    
    function makeTeaser(body, searchterms) {
        // The strategy is as follows:
        // First, assign a value to each word in the document:
        //  Words that correspond to search terms (stemmer aware): 40
        //  Normal words: 2
        //  First word in a sentence: 8
        // Then use a sliding window with a constant number of words and count the
        // sum of the values of the words within the window. Then use the window that got the
        // maximum sum. If there are multiple maximas, then get the last one.
        // Enclose the terms in <em>.
        var stemmed_searchterms = searchterms.map(elasticlunr.stemmer);
        var searchterm_weight = 40;
        var weighted = []; // contains elements of ["word", weight, index_in_document]
        // split in sentences, then words
        var sentences = body.split('. ');
        var index = 0;
        var value = 0;
        var searchterm_found = false;
        for (var sentenceindex in sentences) {
            var words = sentences[sentenceindex].split(' ');
            value = 8;
            for (var wordindex in words) {
                var word = words[wordindex];
                if (word.length > 0) {
                    for (var searchtermindex in stemmed_searchterms) {
                        if (elasticlunr.stemmer(word).startsWith(stemmed_searchterms[searchtermindex])) {
                            value = searchterm_weight;
                            searchterm_found = true;
                        }
                    };
                    weighted.push([word, value, index]);
                    value = 2;
                }
                index += word.length;
                index += 1; // ' ' or '.' if last word in sentence
            };
            index += 1; // because we split at a two-char boundary '. '
        };

        if (weighted.length == 0) {
            return body;
        }

        var window_weight = [];
        var window_size = Math.min(weighted.length, searchoptions.teaser_word_count);

        var cur_sum = 0;
        for (var wordindex = 0; wordindex < window_size; wordindex++) {
            cur_sum += weighted[wordindex][1];
        };
        window_weight.push(cur_sum);
        for (var wordindex = 0; wordindex < weighted.length - window_size; wordindex++) {
            cur_sum -= weighted[wordindex][1];
            cur_sum += weighted[wordindex + window_size][1];
            window_weight.push(cur_sum);
        };

        if (searchterm_found) {
            var max_sum = 0;
            var max_sum_window_index = 0;
            // backwards
            for (var i = window_weight.length - 1; i >= 0; i--) {
                if (window_weight[i] > max_sum) {
                    max_sum = window_weight[i];
                    max_sum_window_index = i;
                }
            };
        } else {
            max_sum_window_index = 0;
        }

        // add <em/> around searchterms
        var teaser_split = [];
        var index = weighted[max_sum_window_index][2];
        for (var i = max_sum_window_index; i < max_sum_window_index+window_size; i++) {
            var word = weighted[i];
            if (index < word[2]) {
                // missing text from index to start of `word`
                teaser_split.push(body.substring(index, word[2]));
                index = word[2];
            }
            if (word[1] == searchterm_weight) {
                teaser_split.push("<em>")
            }
            index = word[2] + word[0].length;
            teaser_split.push(body.substring(word[2], index));
            if (word[1] == searchterm_weight) {
                teaser_split.push("</em>")
            }
        };

        return teaser_split.join('');
    }

    function init() {
        var request = new XMLHttpRequest();
        request.open('GET', path_to_root + 'searchindex.json', true);
        
        request.onload = function() {
            if (this.status >= 200 && this.status < 400) {
                var json = JSON.parse(this.response);

                if (json.enable == false) {
                    searchicon.style.display = 'none';
                    return;
                }

                searchoptions = json.searchoptions;
                searchindex = elasticlunr.Index.load(json.index);

                // Set up events
                searchicon.addEventListener('click', function(e) { searchIconClickHandler(); }, false);
                searchbar.addEventListener('keyup', function(e) { searchbarKeyUpHandler(); }, false);
                document.addEventListener('keydown', function (e) { globalKeyHandler(e); }, false);
                // If the user uses the browser buttons, do the same as if a reload happened
                window.onpopstate = function(e) { doSearchOrMarkFromUrl(); };

                // If reloaded, do the search or mark again, depending on the current url parameters
                doSearchOrMarkFromUrl();
            }
        };        
        request.send();
    }
    
    function unfocusSearchbar() {
        // hacky, but just focusing a div only works once
        var tmp = document.createElement('input');
        tmp.setAttribute('style', 'position: absolute; opacity: 0;');
        searchicon.appendChild(tmp);
        tmp.focus();
        tmp.remove();
    }
    
    // On reload or browser history backwards/forwards events, parse the url and do search or mark
    function doSearchOrMarkFromUrl() {
        // Check current URL for search request
        var url = parseURL(window.location.href);
        if (url.params.hasOwnProperty(URL_SEARCH_PARAM)
            && url.params[URL_SEARCH_PARAM] != "") {
            searchbar_outer.style.display = '';
            searchbar.value = decodeURIComponent(
                (url.params[URL_SEARCH_PARAM]+'').replace(/\+/g, '%20'));
            searchbarKeyUpHandler(); // -> doSearch()
        } else {
            searchbar_outer.style.display = 'none';
        }

        if (url.params.hasOwnProperty(URL_MARK_PARAM)) {
            var words = url.params[URL_MARK_PARAM].split(' ');
            var header = document.getElementById('' + url.hash);
            marker.mark(words, {
                exclude : mark_exclude
            });
        }
    }
    
    // Eventhandler for keyevents on `document`
    function globalKeyHandler(e) {
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) { return; }

        if (e.keyCode == ESCAPE_KEYCODE) {
            e.preventDefault();
            searchbar.classList.remove("active");
            setSearchUrlParameters("",
                (searchbar.value.trim() != "") ? "push" : "replace");
            if (hasFocus()) {
                unfocusSearchbar();
            }
            // TODO: animation
            searchbar_outer.style.display = 'none';
            marker.unmark();
            return;
        }
        if (!hasFocus() && e.keyCode == SEARCH_HOTKEY_KEYCODE) {
            e.preventDefault();
            searchbar_outer.style.display = '';
            searchbar.focus();
            return;
        }
        if (hasFocus() && e.keyCode == DOWN_KEYCODE) {
            e.preventDefault();
            unfocusSearchbar();
            searchresults.children('li').first().classList.add("focus");
            return;
        }
        if (!hasFocus() && (e.keyCode == DOWN_KEYCODE
                                    || e.keyCode == UP_KEYCODE
                                    || e.keyCode == SELECT_KEYCODE)) {
            // not `:focus` because browser does annoying scrolling
            var current_focus = search.searchresults.find("li.focus");
            if (current_focus.length == 0) return;
            e.preventDefault();
            if (e.keyCode == DOWN_KEYCODE) {
                var next = current_focus.next()
                if (next.length > 0) {
                    current_focus.classList.remove("focus");
                    next.classList.add("focus");
                }
            } else if (e.keyCode == UP_KEYCODE) {
                current_focus.classList.remove("focus");
                var prev = current_focus.prev();
                if (prev.length == 0) {
                    searchbar.focus();
                } else {
                    prev.classList.add("focus");
                }
            } else {
                window.location = current_focus.children('a').attr('href');
            }
        }
    }
    
    function showSearchBar(yes) {
        if (yes) {
            searchbar_outer.style.display = 'block';
            searchresults_outer.style.display = 'block';
            menu_title.style.display = 'none';
        } else {
            searchbar_outer.style.display = 'none';
            searchresults_outer.style.display = 'none';
            menu_title.style.display = 'block';
        }
    }

    // Eventhandler for search icon
    function searchIconClickHandler() {
        showSearchBar(searchbar_outer.style.display === 'none');
        searchbar.focus();
    }
    
    // Eventhandler for keyevents while the searchbar is focused
    function searchbarKeyUpHandler() {
        var searchterm = searchbar.value.trim();
        if (searchterm != "") {
            searchbar.classList.add("active");
            doSearch(searchterm);
        } else {
            searchbar.classList.remove("active");
            searchresults_outer.style.display = 'none';
            removeChildren(searchresults);
        }

        setSearchUrlParameters(searchterm, "push_if_new_search_else_replace");

        // Remove marks
        marker.unmark();
    }
    
    // Update current url with ?URL_SEARCH_PARAM= parameter, remove ?URL_MARK_PARAM and #heading-anchor .
    // `action` can be one of "push", "replace", "push_if_new_search_else_replace"
    // and replaces or pushes a new browser history item.
    // "push_if_new_search_else_replace" pushes if there is no `?URL_SEARCH_PARAM=abc` yet.
    function setSearchUrlParameters(searchterm, action) {
        var url = parseURL(window.location.href);
        var first_search = ! url.params.hasOwnProperty(URL_SEARCH_PARAM);
        if (searchterm != "" || action == "push_if_new_search_else_replace") {
            url.params[URL_SEARCH_PARAM] = searchterm;
            delete url.params[URL_MARK_PARAM];
            url.hash = "";
        } else {
            delete url.params[URL_SEARCH_PARAM];
        }
        // A new search will also add a new history item, so the user can go back
        // to the page prior to searching. A updated search term will only replace
        // the url.
        if (action == "push" || (action == "push_if_new_search_else_replace" && first_search) ) {
            history.pushState({}, document.title, renderURL(url));
        } else if (action == "replace" || (action == "push_if_new_search_else_replace" && !first_search) ) {
            history.replaceState({}, document.title, renderURL(url));
        }
    }
    
    function doSearch(searchterm) {

        // Don't search the same twice
        if (current_searchterm == searchterm) { return; }
        else { current_searchterm = searchterm; }

        if (searchindex == null) { return; }

        // Do the actual search
        var results = searchindex.search(searchterm, searchoptions);
        var resultcount = Math.min(results.length, searchoptions.limit_results);

        // Display search metrics
        searchresults_header.innerText = formatSearchMetric(resultcount, searchterm);

        // Clear and insert results
        var searchterms  = searchterm.split(' ');
        removeChildren(searchresults);
        for(var i = 0; i < resultcount ; i++){
            var resultElem = document.createElement('li');
            resultElem.innerHTML = formatSearchResult(results[i], searchterms);
            searchresults.appendChild(resultElem);
        }

        // Display and scroll to results
        searchresults_outer.style.display = 'block';
    }

    init();
    return {
        hasFocus: function() {
            return document.getElementById('searchbar') === document.activeElement;
        }
    };
})();
