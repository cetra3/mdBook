use renderer::html_handlebars::helpers;
use renderer::{RenderContext, Renderer};
use book::{Book, BookItem, Chapter};
use config::{Config, HtmlConfig, Playpen, Search};
use {theme, utils};
use theme::{playpen_editor, Theme};
use errors::*;
use regex::{Captures, Regex};

#[allow(unused_imports)] use std::ascii::AsciiExt;
use std::borrow::Cow;
use std::path::{Path, PathBuf};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::collections::BTreeMap;
use std::collections::HashMap;

use elasticlunr;
use handlebars::Handlebars;
use serde_json;

fn write_file<P: AsRef<Path>>(
    build_dir: &Path,
    filename: P,
    content: &[u8],
) -> Result<()> {
    let path = build_dir.join(filename);

    utils::fs::create_file(&path)?
        .write_all(content)
        .map_err(|e| e.into())
}

#[derive(Default)]
pub struct HtmlHandlebars;

impl HtmlHandlebars {
    pub fn new() -> Self {
        HtmlHandlebars
    }

    fn render_item(
        &self,
        item: &BookItem,
        mut ctx: RenderItemContext,
        print_content: &mut String,
        search_index: &mut Option<elasticlunr::Index>,
    ) -> Result<()> {
        // FIXME: This should be made DRY-er and rely less on mutable state
        match *item {
            BookItem::Chapter(ref ch) => {
                let content = ch.content.clone();
                let content = utils::render_markdown(&content, ctx.html_config.curly_quotes);
                print_content.push_str(&content);

                // Update the context with data for this file
                let path = ch.path
                    .to_str()
                    .chain_err(|| "Could not convert path to str")?;
                let filepath = Path::new(&ch.path)
                    .with_extension("html");
                let filepath = filepath.to_str()
                    .chain_err(|| "Could not convert HTML path to str")?;

                // "print.html" is used for the print page.
                if ch.path == Path::new("print.md") {
                    bail!(ErrorKind::ReservedFilenameError(ch.path.clone()));
                };

                // Add page content to search index
                if let Some(ref mut index) = *search_index {
                    add_chapter_to_searchindex(&ctx.html_config.search, &ch, &filepath, index);
                }

                // Non-lexical lifetimes needed :'(
                let title: String;
                {
                    let book_title = ctx.data
                                        .get("book_title")
                                        .and_then(serde_json::Value::as_str)
                                        .unwrap_or("");
                    title = ch.name.clone() + " - " + book_title;
                }

                ctx.data.insert("path".to_owned(), json!(path));
                ctx.data.insert("content".to_owned(), json!(content));
                ctx.data.insert("chapter_title".to_owned(), json!(ch.name));
                ctx.data.insert("title".to_owned(), json!(title));
                ctx.data.insert("path_to_root".to_owned(),
                                json!(utils::fs::path_to_root(&ch.path)));

                // Render the handlebars template with the data
                debug!("Render template");
                let rendered = ctx.handlebars.render("index", &ctx.data)?;

                let rendered = self.post_process(
                    rendered,
                    &normalize_path(filepath),
                    &ctx.html_config.playpen,
                );

                // Write to file
                debug!("Creating {} ✓", filepath);
                write_file(&ctx.destination, filepath, &rendered.into_bytes())?;

                if ctx.is_index {
                    self.render_index(ch, &ctx.destination)?;
                }
            }
            _ => {}
        }

        Ok(())
    }

    /// Create an index.html from the first element in SUMMARY.md
    fn render_index(&self, ch: &Chapter, destination: &Path) -> Result<()> {
        debug!("index.html");

        let mut content = String::new();

        File::open(destination.join(&ch.path.with_extension("html")))?
            .read_to_string(&mut content)?;

        // This could cause a problem when someone displays
        // code containing <base href=...>
        // on the front page, however this case should be very very rare...
        content = content.lines()
                         .filter(|line| !line.contains("<base href="))
                         .collect::<Vec<&str>>()
                         .join("\n");

        write_file(destination, "index.html", content.as_bytes())?;

        debug!(
            "Creating index.html from {} ✓",
            destination.join(&ch.path.with_extension("html")).display()
        );

        Ok(())
    }

    #[cfg_attr(feature = "cargo-clippy", allow(let_and_return))]
    fn post_process(&self,
                    rendered: String,
                    filepath: &str,
                    playpen_config: &Playpen)
                    -> String {
        let rendered = build_header_links(&rendered, filepath);
        let rendered = fix_anchor_links(&rendered, filepath);
        let rendered = fix_code_blocks(&rendered);
        let rendered = add_playpen_pre(&rendered, playpen_config);

        rendered
    }

    fn copy_static_files(
        &self,
        destination: &Path,
        theme: &Theme,
        html_config: &HtmlConfig,
    ) -> Result<()> {
        write_file(destination, "book.js", &theme.js)?;
        write_file(destination, "book.css", &theme.css)?;
        write_file(destination, "favicon.png", &theme.favicon)?;
        write_file(destination, "highlight.css", &theme.highlight_css)?;
        write_file(destination, "tomorrow-night.css", &theme.tomorrow_night_css)?;
        write_file(destination, "ayu-highlight.css", &theme.ayu_highlight_css)?;
        write_file(destination, "highlight.js", &theme.highlight_js)?;
        write_file(destination, "clipboard.min.js", &theme.clipboard_js)?;
        write_file(
            destination,
            "_FontAwesome/css/font-awesome.css",
            theme::FONT_AWESOME,
        )?;
        write_file(
            destination,
            "_FontAwesome/fonts/fontawesome-webfont.eot",
            theme::FONT_AWESOME_EOT,
        )?;
        write_file(
            destination,
            "_FontAwesome/fonts/fontawesome-webfont.svg",
            theme::FONT_AWESOME_SVG,
        )?;
        write_file(
            destination,
            "_FontAwesome/fonts/fontawesome-webfont.ttf",
            theme::FONT_AWESOME_TTF,
        )?;
        write_file(
            destination,
            "_FontAwesome/fonts/fontawesome-webfont.woff",
            theme::FONT_AWESOME_WOFF,
        )?;
        write_file(
            destination,
            "_FontAwesome/fonts/fontawesome-webfont.woff2",
            theme::FONT_AWESOME_WOFF2,
        )?;
        write_file(
            destination,
            "_FontAwesome/fonts/FontAwesome.ttf",
            theme::FONT_AWESOME_TTF,
        )?;

        let playpen_config = &html_config.playpen;

        // Ace is a very large dependency, so only load it when requested
        if playpen_config.editable {
            // Load the editor
            let editor = playpen_editor::PlaypenEditor::new(&playpen_config.editor);
            write_file(destination, "editor.js", &editor.js)?;
            write_file(destination, "ace.js", &editor.ace_js)?;
            write_file(destination, "mode-rust.js", &editor.mode_rust_js)?;
            write_file(destination, "theme-dawn.js", &editor.theme_dawn_js)?;
            write_file(destination,
                "theme-tomorrow_night.js",
                &editor.theme_tomorrow_night_js,
            )?;
        }

        Ok(())
    }

    /// Update the context with data for this file
    fn configure_print_version(&self,
                               data: &mut serde_json::Map<String, serde_json::Value>,
                               print_content: &str) {
        // Make sure that the Print chapter does not display the title from
        // the last rendered chapter by removing it from its context
        data.remove("title");
        data.insert("is_print".to_owned(), json!(true));
        data.insert("path".to_owned(), json!("print.md"));
        data.insert("content".to_owned(), json!(print_content));
        data.insert("path_to_root".to_owned(),
                    json!(utils::fs::path_to_root(Path::new("print.md"))));
    }

    fn register_hbs_helpers(&self, handlebars: &mut Handlebars, html_config: &HtmlConfig) {
        handlebars.register_helper("toc", Box::new(helpers::toc::RenderToc {no_section_label: html_config.no_section_label}));
        handlebars.register_helper("previous", Box::new(helpers::navigation::previous));
        handlebars.register_helper("next", Box::new(helpers::navigation::next));
    }

    /// Copy across any additional CSS and JavaScript files which the book
    /// has been configured to use.
    fn copy_additional_css_and_js(&self, html: &HtmlConfig, destination: &Path) -> Result<()> {
        let custom_files = html.additional_css.iter().chain(html.additional_js.iter());

        debug!("Copying additional CSS and JS");

        for custom_file in custom_files {
            let output_location = destination.join(custom_file);
            if let Some(parent) = output_location.parent() {
                fs::create_dir_all(parent)
                    .chain_err(|| format!("Unable to create {}", parent.display()))?;
            }
            debug!(
                "Copying {} -> {}",
                custom_file.display(),
                output_location.display()
            );

            fs::copy(custom_file, &output_location).chain_err(|| {
                format!(
                    "Unable to copy {} to {}",
                    custom_file.display(),
                    output_location.display()
                )
            })?;
        }

        Ok(())
    }
}

impl Renderer for HtmlHandlebars {
    fn name(&self) -> &str {
        "html"
    }

    fn render(&self, ctx: &RenderContext) -> Result<()> {
        let html_config = ctx.config.html_config().unwrap_or_default();
        let src_dir = ctx.root.join(&ctx.config.book.src);
        let destination = &ctx.destination;
        let book = &ctx.book;

        trace!("render");
        let mut handlebars = Handlebars::new();

        let theme_dir = match html_config.theme {
            Some(ref theme) => theme.to_path_buf(),
            None => src_dir.join("theme"),
        };

        let theme = theme::Theme::new(theme_dir);

        debug!("Register the index handlebars template");
        handlebars.register_template_string("index", String::from_utf8(theme.index.clone())?)?;

        debug!("Register the header handlebars template");
        handlebars.register_partial("header", String::from_utf8(theme.header.clone())?)?;

        debug!("Register handlebars helpers");
        self.register_hbs_helpers(&mut handlebars, &html_config);

        let mut data = make_data(&ctx.root, &book, &ctx.config, &html_config)?;

        // Print version
        let mut print_content = String::new();

        // Search index
        let mut search_index = None;
        if html_config.search.enable {
            search_index = Some(elasticlunr::Index::new(&["title", "body", "breadcrumbs"]));
        }

        fs::create_dir_all(&destination)
            .chain_err(|| "Unexpected error when constructing destination path")?;

        let mut depthfirstiterator = book.iter();
        let mut is_index = true;
        while let Some(item) = depthfirstiterator.next() {
            let ctx = RenderItemContext {
                handlebars: &handlebars,
                destination: destination.to_path_buf(),
                data: data.clone(),
                is_index: is_index,
                html_config: html_config.clone(),
            };
            self.render_item(item,
                             ctx,
                             &mut print_content,
                             &mut search_index)?;
            is_index = false;
        }

        // Search index
        if let Some(index) = search_index {
            write_searchindex_to_json(ctx, &html_config.search, index)?;
        }

        // Print version
        self.configure_print_version(&mut data, &print_content);
        if let Some(ref title) = ctx.config.book.title {
            data.insert("title".to_owned(), json!(title));
        }

        // Render the handlebars template with the data
        debug!("Render template");

        let rendered = handlebars.render("index", &data)?;

        let rendered = self.post_process(rendered,
                                         "print.html",
                                         &html_config.playpen);

        write_file(&destination, "print.html", &rendered.into_bytes())?;
        debug!("Creating print.html ✓");

        debug!("Copy static files");
        self.copy_static_files(&destination, &theme, &html_config)
            .chain_err(|| "Unable to copy across static files")?;
        self.copy_additional_css_and_js(&html_config, &destination)
            .chain_err(|| "Unable to copy across additional CSS and JS")?;

        // Copy all remaining files
        utils::fs::copy_files_except_ext(&src_dir, &destination, true, &["md"])?;

        Ok(())
    }
}

fn make_data(root: &Path, book: &Book, config: &Config, html_config: &HtmlConfig) -> Result<serde_json::Map<String, serde_json::Value>> {
    trace!("make_data");
    let html = config.html_config().unwrap_or_default();

    let mut data = serde_json::Map::new();
    data.insert("language".to_owned(), json!("en"));
    data.insert("book_title".to_owned(), json!(config.book.title.clone().unwrap_or_default()));
    data.insert("description".to_owned(), json!(config.book.description.clone().unwrap_or_default()));
    data.insert("favicon".to_owned(), json!("favicon.png"));
    if let Some(ref livereload) = html_config.livereload_url {
        data.insert("livereload".to_owned(), json!(livereload));
    }

    // Add google analytics tag
    if let Some(ref ga) = config.html_config().and_then(|html| html.google_analytics) {
        data.insert("google_analytics".to_owned(), json!(ga));
    }

    if html.mathjax_support {
        data.insert("mathjax_support".to_owned(), json!(true));
    }

    // Add check to see if there is an additional style
    if !html.additional_css.is_empty() {
        let mut css = Vec::new();
        for style in &html.additional_css {
            match style.strip_prefix(root) {
                Ok(p) => css.push(p.to_str().expect("Could not convert to str")),
                Err(_) => {
                    css.push(style.file_name()
                                  .expect("File has a file name")
                                  .to_str()
                                  .expect("Could not convert to str"))
                }
            }
        }
        data.insert("additional_css".to_owned(), json!(css));
    }

    // Add check to see if there is an additional script
    if !html.additional_js.is_empty() {
        let mut js = Vec::new();
        for script in &html.additional_js {
            match script.strip_prefix(root) {
                Ok(p) => js.push(p.to_str().expect("Could not convert to str")),
                Err(_) => {
                    js.push(script.file_name()
                                  .expect("File has a file name")
                                  .to_str()
                                  .expect("Could not convert to str"))
                }
            }
        }
        data.insert("additional_js".to_owned(), json!(js));
    }

    if html.playpen.editable {
        data.insert("playpens_editable".to_owned(), json!(true));
        data.insert("editor_js".to_owned(), json!("editor.js"));
        data.insert("ace_js".to_owned(), json!("ace.js"));
        data.insert("mode_rust_js".to_owned(), json!("mode-rust.js"));
        data.insert("theme_dawn_js".to_owned(), json!("theme-dawn.js"));
        data.insert("theme_tomorrow_night_js".to_owned(),
                    json!("theme-tomorrow_night.js"));
    }

    data.insert("search".to_owned(), json!(html.search.enable));

    let mut chapters = vec![];

    for item in book.iter() {
        // Create the data to inject in the template
        let mut chapter = BTreeMap::new();

        match *item {
            BookItem::Chapter(ref ch) => {
                if let Some(ref section) = ch.number {
                    chapter.insert("section".to_owned(), json!(section.to_string()));
                }

                chapter.insert("name".to_owned(), json!(ch.name));
                let path = ch.path
                    .to_str()
                    .chain_err(|| "Could not convert path to str")?;
                chapter.insert("path".to_owned(), json!(path));
            }
            BookItem::Separator => {
                chapter.insert("spacer".to_owned(), json!("_spacer_"));
            }
        }

        chapters.push(chapter);
    }

    data.insert("chapters".to_owned(), json!(chapters));

    debug!("[*]: JSON constructed");
    Ok(data)
}

/// Goes through the rendered HTML, making sure all header tags are wrapped in
/// an anchor so people can link to sections directly.
fn build_header_links(html: &str, filepath: &str) -> String {
    let regex = Regex::new(r"<h(\d)>(.*?)</h\d>").unwrap();
    let mut id_counter = HashMap::new();

    regex.replace_all(html, |caps: &Captures| {
        let level = caps[1].parse()
                           .expect("Regex should ensure we only ever get numbers here");

        wrap_header_with_link(level, &caps[2], &mut id_counter, filepath)
    })
         .into_owned()
}

/// Wraps a single header tag with a link, making sure each tag gets its own
/// unique ID by appending an auto-incremented number (if necessary).
fn wrap_header_with_link(level: usize,
                         content: &str,
                         id_counter: &mut HashMap<String, usize>,
                         filepath: &str)
                         -> String {
    let raw_id = id_from_content(content);

    let id_count = id_counter.entry(raw_id.clone()).or_insert(0);

    let id = match *id_count {
        0 => raw_id,
        other => format!("{}-{}", raw_id, other),
    };

    *id_count += 1;

    format!(
        r##"<a class="header" href="{filepath}#{id}" id="{id}"><h{level}>{text}</h{level}></a>"##,
        level = level,
        id = id,
        text = content,
        filepath = filepath
    )
}

/// Generate an id for use with anchors which is derived from a "normalised"
/// string.
fn id_from_content(content: &str) -> String {
    let mut content = content.to_string();

    // Skip any tags or html-encoded stuff
    const REPL_SUB: &[&str] = &["<em>",
                                "</em>",
                                "<code>",
                                "</code>",
                                "<strong>",
                                "</strong>",
                                "&lt;",
                                "&gt;",
                                "&amp;",
                                "&#39;",
                                "&quot;"];
    for sub in REPL_SUB {
        content = content.replace(sub, "");
    }

    // Remove spaces and hastags indicating a header
    let trimmed = content.trim().trim_left_matches('#').trim();

    normalize_id(trimmed)
}

// anchors to the same page (href="#anchor") do not work because of
// <base href="../"> pointing to the root folder. This function *fixes*
// that in a very inelegant way
fn fix_anchor_links(html: &str, filepath: &str) -> String {
    let regex = Regex::new(r##"<a([^>]+)href="#([^"]+)"([^>]*)>"##).unwrap();
    regex.replace_all(html, |caps: &Captures| {
        let before = &caps[1];
        let anchor = &caps[2];
        let after = &caps[3];

        format!("<a{before}href=\"{filepath}#{anchor}\"{after}>",
                before = before,
                filepath = filepath,
                anchor = anchor,
                after = after)
    })
         .into_owned()
}


// The rust book uses annotations for rustdoc to test code snippets,
// like the following:
// ```rust,should_panic
// fn main() {
//     // Code here
// }
// ```
// This function replaces all commas by spaces in the code block classes
fn fix_code_blocks(html: &str) -> String {
    let regex = Regex::new(r##"<code([^>]+)class="([^"]+)"([^>]*)>"##).unwrap();
    regex.replace_all(html, |caps: &Captures| {
        let before = &caps[1];
        let classes = &caps[2].replace(",", " ");
        let after = &caps[3];

        format!(r#"<code{before}class="{classes}"{after}>"#,
                before = before,
                classes = classes,
                after = after)
    }).into_owned()
}

fn add_playpen_pre(html: &str, playpen_config: &Playpen) -> String {
    let regex = Regex::new(r##"((?s)<code[^>]?class="([^"]+)".*?>(.*?)</code>)"##).unwrap();
    regex.replace_all(html, |caps: &Captures| {
        let text = &caps[1];
        let classes = &caps[2];
        let code = &caps[3];

        if (classes.contains("language-rust") && !classes.contains("ignore")) ||
            classes.contains("mdbook-runnable")
        {
            // wrap the contents in an external pre block
            if playpen_config.editable && classes.contains("editable") ||
                text.contains("fn main") || text.contains("quick_main!")
            {
                format!("<pre class=\"playpen\">{}</pre>", text)
            } else {
                // we need to inject our own main
                let (attrs, code) = partition_source(code);

                format!("<pre class=\"playpen\"><code class=\"{}\">\n# \
                         #![allow(unused_variables)]\n\
                         {}#fn main() {{\n\
                         {}\
                         #}}</code></pre>",
                        classes,
                        attrs,
                        code)
            }
        } else {
            // not language-rust, so no-op
            text.to_owned()
        }
    })
         .into_owned()
}

fn partition_source(s: &str) -> (String, String) {
    let mut after_header = false;
    let mut before = String::new();
    let mut after = String::new();

    for line in s.lines() {
        let trimline = line.trim();
        let header = trimline.chars().all(|c| c.is_whitespace()) || trimline.starts_with("#![");
        if !header || after_header {
            after_header = true;
            after.push_str(line);
            after.push_str("\n");
        } else {
            before.push_str(line);
            before.push_str("\n");
        }
    }

    (before, after)
}

struct RenderItemContext<'a> {
    handlebars: &'a Handlebars,
    destination: PathBuf,
    data: serde_json::Map<String, serde_json::Value>,
    is_index: bool,
    html_config: HtmlConfig,
}

pub fn normalize_path(path: &str) -> String {
    use std::path::is_separator;
    path.chars()
        .map(|ch| if is_separator(ch) { '/' } else { ch })
        .collect::<String>()
}

pub fn normalize_id(content: &str) -> String {
    content.chars()
           .filter_map(|ch| if ch.is_alphanumeric() || ch == '_' || ch == '-' {
                           Some(ch.to_ascii_lowercase())
                       } else if ch.is_whitespace() {
                           Some('-')
                       } else {
                           None
                       })
           .collect::<String>()
}

/// Renders markdown into flat unformatted text for usage in the search index.
pub fn add_chapter_to_searchindex(
    searchconfig: &Search,
    chapter: &Chapter,
    anchor_base: &str,
    index: &mut elasticlunr::Index,
) {
    use pulldown_cmark::*;

    let mut opts = Options::empty();
    opts.insert(OPTION_ENABLE_TABLES);
    opts.insert(OPTION_ENABLE_FOOTNOTES);
    let p = Parser::new_ext(&chapter.content, opts);

    let mut in_header = false;
    let max_paragraph_level = searchconfig.split_until_heading as i32;
    let mut paragraph_id = None;
    let mut heading = String::new();
    let mut body = String::new();
    let mut breadcrumbs = chapter.parent_names.clone();

    for event in p {
        match event {
            Event::Start(Tag::Header(i)) if i <= max_paragraph_level => {
                if heading.len() > 0 {
                    // Paragraph finished, the next header is following now
                    // Write the data to the index, and clear it for the next paragraph
                    let doc_ref = if let Some(id) = paragraph_id {
                        Cow::Owned(format!("{}#{}", anchor_base, id))
                    } else {
                        Cow::Borrowed(anchor_base)
                    };
                    index.add_doc(&doc_ref, &[&heading, &body, &breadcrumbs.join(" » ")]);
                    paragraph_id = None;
                    heading.clear();
                    body.clear();
                    breadcrumbs.pop();
                }

                in_header = true;
            }
            Event::End(Tag::Header(i)) if i <= max_paragraph_level => {
                in_header = false;
                paragraph_id = Some(id_from_content(&heading));

                breadcrumbs.push(heading.clone());
            }
            Event::Start(_) | Event::End(_) => {}
            Event::Text(text) => {
                if in_header {
                    heading.push_str(&text);
                } else {
                    body.push_str(&text);
                }
            }
            Event::Html(html) | Event::InlineHtml(html) => {
                body.push_str(&utils::remove_html_tags(&html));
            }
            Event::FootnoteReference(_) => {}
            Event::SoftBreak | Event::HardBreak => {}
        }
    }
}

/// Uses elasticlunr to create a search index and exports that into `searchindex.json`.
fn write_searchindex_to_json(
    ctx: &RenderContext,
    searchconfig: &Search,
    index: elasticlunr::Index
) -> Result<()> {

    // These structs mirror the configuration javascript object accepted by
    // http://elasticlunr.com/docs/configuration.js.html

    #[derive(Serialize)]
    struct SearchOptionsField {
        boost: u8,
    }

    #[derive(Serialize)]
    struct SearchOptionsFields {
        title: SearchOptionsField,
        body: SearchOptionsField,
        breadcrumbs: SearchOptionsField,
    }

    #[derive(Serialize)]
    struct SearchOptions {
        bool: String,
        expand: bool,
        limit_results: u32,
        teaser_word_count: u32,
        fields: SearchOptionsFields,
    }

    #[derive(Serialize)]
    struct SearchindexJson {
        /// Propagate the search enabled/disabled setting to the html page
        enable: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        /// The searchoptions for elasticlunr.js
        searchoptions: Option<SearchOptions>,
        /// The index for elasticlunr.js
        #[serde(skip_serializing_if = "Option::is_none")]
        index: Option<elasticlunr::Index>,

    }

    let json_contents = if searchconfig.enable {
        let searchoptions = SearchOptions {
            bool: if searchconfig.use_boolean_and { "AND".into() } else { "OR".into() },
            expand: searchconfig.expand,
            limit_results: searchconfig.limit_results,
            teaser_word_count: searchconfig.teaser_word_count,
            fields: SearchOptionsFields {
                title: SearchOptionsField { boost: searchconfig.boost_title },
                body: SearchOptionsField { boost: searchconfig.boost_paragraph },
                breadcrumbs: SearchOptionsField { boost: searchconfig.boost_hierarchy },
            }
        };

        SearchindexJson {
            enable: searchconfig.enable,
            searchoptions: Some(searchoptions),
            index: Some(index),
        }
    } else {
        SearchindexJson {
            enable: false,
            searchoptions: None,
            index: None,
        }
    };

    write_file(
        &ctx.destination,
        "searchindex.json",
        &serde_json::to_string(&json_contents).unwrap().as_bytes(),
    )?;
    debug!("Creating \"searchindex.json\" ✓");

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn original_build_header_links() {
        let inputs = vec![
            (
                "blah blah <h1>Foo</h1>",
                r##"blah blah <a class="header" href="./some_chapter/some_section.html#foo" id="foo"><h1>Foo</h1></a>"##,
            ),
            (
                "<h1>Foo</h1>",
                r##"<a class="header" href="./some_chapter/some_section.html#foo" id="foo"><h1>Foo</h1></a>"##,
            ),
            (
                "<h3>Foo^bar</h3>",
                r##"<a class="header" href="./some_chapter/some_section.html#foobar" id="foobar"><h3>Foo^bar</h3></a>"##,
            ),
            (
                "<h4></h4>",
                r##"<a class="header" href="./some_chapter/some_section.html#" id=""><h4></h4></a>"##,
            ),
            (
                "<h4><em>Hï</em></h4>",
                r##"<a class="header" href="./some_chapter/some_section.html#hï" id="hï"><h4><em>Hï</em></h4></a>"##,
            ),
            (
                "<h1>Foo</h1><h3>Foo</h3>",
                r##"<a class="header" href="./some_chapter/some_section.html#foo" id="foo"><h1>Foo</h1></a><a class="header" href="./some_chapter/some_section.html#foo-1" id="foo-1"><h3>Foo</h3></a>"##,
            ),
        ];

        for (src, should_be) in inputs {
            let filepath = "./some_chapter/some_section.html";
            let got = build_header_links(&src, filepath);
            assert_eq!(got, should_be);

            // This is redundant for most cases
            let got = fix_anchor_links(&got, filepath);
            assert_eq!(got, should_be);
        }
    }

    #[test]
    fn anchor_generation() {
        assert_eq!(id_from_content("## `--passes`: add more rustdoc passes"),
                   "--passes-add-more-rustdoc-passes");
        assert_eq!(id_from_content("## Method-call expressions"),
                   "method-call-expressions");
    }
}
