import path from 'path'
import fs from 'fs'
import {parseArgs} from 'node:util'
import {spawnSync} from 'node:child_process'
import {mkdirp} from 'mkdirp'

'use strict'

const fs_promises = fs.promises;

function print_usage() {
  console.log(`node app.js --source path [--dest path] [--prefix string] [--replacement string] [--suffix string] [--order] [--season number] [--offset number] [--copy] [--dryrun] [--force] [--dot] [--touch] [--incoming] [--extract] [--chd] [--chdman path] [--recurse] [--help]`);
  console.log(`  --source path  Searches for files to rename in directory named by path`);
  console.log(`  --dest path  Places renamed files into directory named by path`);
  console.log(`  --prefix string  When renaming based on filenames, looks for string as a prefix of each filename. When renaming based on file order, this prefix is used as the base filename unless TV show mode is enabled.`);
  console.log(`  --replacement string  Replace the string found via --prefix with this string when renaming based on filenames`);
  console.log(`  --suffix string  Looks for string as a suffix of each filename (and removes it during rename) when renaming based on filenames`);
  console.log(`  --order  Renames files based on their sort order within the directory`);
  console.log(`  --season number  When renaming based on sort order, use number as season. Only applies when TV show mode is enabled.`);
  console.log(`  --offset number  When renaming based on file order, starts numbering files from this offset. In TV show mode, this is the episode number.`);
  console.log(`  --copy  Copy the files from source rather than moving them during rename`);
  console.log(`  --dryrun  Does everything but perform the actual rename on files`);
  console.log(`  --force  Continue on error`);
  console.log(`  --dot  Don't skip files with names beginning with dot ('.') character. Default is to ignore them.`);
  console.log(`  --touch  Touch the files in source path but do not rename them`);
  console.log(`  --incoming  Check the extract folder in an incoming folder for missing files`);
  console.log(`  --extract  Extract a single incoming file/folder into the extract folder. --source argument is used as the incoming file/folder and --dest as the root folder.`);
  console.log(`  --chd  Convert all disc images in source path into chd rooted at dest path`);
  console.log(`  --chdman path  Path to the chdman binary for use by the --chd switch`);
  console.log(`  --winrar path  Path to the winrar binary for use by the --extract switch`);
  console.log(`  --recurse  Recurse into subdirectories`);
  console.log(`  --help  Display this message`);
  console.log('');
}

const options = {
  source: {
    type: 'string',
    default: '',
    short: 's',
  },
  prefix: {
    type: 'string',
    default: '',
  },
  replacement: {
    type: 'string',
    default: '',
  },
  suffix: {
    type: 'string',
    default: '',
  },
  dest: {
    type: 'string',
    default: '',
    short: 'd',
  },
  // rename based on file index
  order: {
    type: 'boolean',
    default: false,
    short: 'o',
  },
  // TV season number
  season: {
    type: 'string',
    default: '1',
  },
  // Starting offset
  offset: {
    type: 'string',
    default: '1',
  },
  // copy instead of rename files
  copy: {
    type: 'boolean',
    default: false,
    short: 'c',
  },
  // touch the files instead of renaming them
  touch: {
    type: 'boolean',
    default: false,
  },
  incoming: {
    type: 'boolean',
    default: false,
  },
  chd: {
    type: 'boolean',
    default: false,
  },
  extract: {
    type: 'boolean',
    default: false,
  },
  chdman: {
    type: 'string',
    default: 'chdman',
  },
  winrar: {
    type: 'string',
    default: 'C:/Program Files/WinRAR/Rar.exe',
  },
  // do not perform actions
  dryrun: {
    type: 'boolean',
    default: false,
    short: 'n',
  },
  // continue on error
  force: {
    type: 'boolean',
    default: false,
    short: 'f',
  },
  // allow dot files
  dot: {
    type: 'boolean',
    default: false,
    short: 'f',
  },
  // recurse into subdirectories
  recurse: {
    type: 'boolean',
    default: false,
    short: 'r',
  },
  // display this help
  help: {
    type: 'boolean',
    default: false,
    short: 'h',
  },
};
const config = parseArgs({options}).values;

const file_logger = {
  is_enabled: false,
  file: null,
  write(str) {
    if (file_logger.is_enabled) {
      fs.writeSync(file_logger.file, `${str}\n`);
      fs.fsyncSync(file_logger.file);
    }
  },
  open(filename) {
    file_logger.file = fs.openSync(filename, 'w+');
    file_logger.is_enabled = true;
  },
  close() {
    if (file_logger.is_enabled) {
      fs.closeSync(file_logger.file);
    }
    file_logger.is_enabled = false;
    file_logger.file = null;
  },
};

function log(str) {
  console.log(str)
  file_logger.write(str);
}

function log_error(str) {
  console.error(str)
  file_logger.write(str);
}

function enable_file_logger(filename) {
  file_logger.open(filename);
}

async function get_files(dir, skip_dot, recurse, force) {
  const all_files = await fs_promises.readdir(dir);
  let files = [];
  let dirs = [];
  for (const file of all_files) {
    if (file.startsWith('.') && skip_dot) {
      continue;
    }
    const fullpath = path.join(dir, file);
    try {
      const v = fs.statSync(fullpath);
      if (v.isDirectory()) {
        dirs.push(fullpath);
        if (recurse) {
          const result = await get_files(fullpath, skip_dot, recurse, force);
          files = files.concat(result.files);
          dirs = dirs.concat(result.dirs);
        }
        continue;
      }
      files.push(fullpath);
    } catch (e) {
      log_error(`Caught error: ${JSON.stringify(e)}`);
      if (!force) {
        throw e;
      }
    }
  }
  return {files, dirs};
}

function pad2(n) {
    if (n < 10) {
        return `0${n}`;
    }
    return n;
}

function pad3(n) {
  if (n < 10) {
    return `00${n}`;
  }
  if (n < 100) {
    return `0${n}`;
  }
  return n;
}

function pad4(n) {
  if (n < 10) {
    return `000${n}`;
  }
  if (n < 100) {
    return `00${n}`;
  }
  if (n < 1000) {
    return `0${n}`;
  }
  return n;
}

function mkdir(fullpath) {
  try {
    fs.mkdirSync(fullpath);
  } catch (e) {
    // Ignore 'already-exists' error.
    if (e.code === 'EEXIST') {
      return;
    }
    throw e;
  }
}

function copy_file(fullpath, dest) {
  log(`${fullpath} => ${dest}`);
  if (!config.dryrun) {
    fs.copyFileSync(fullpath, dest);
  }
}

function rename(fullpath, dest) {
  if (config.copy) {
    copy_file(fullpath, dest);
  } else {
    log(`${fullpath} => ${dest}`);
    if (!config.dryrun) {
      fs.renameSync(fullpath, dest);
    }
  }
}

function get_season_episode_for_file_index(index, season = 1, extension = '.mkv') {
  return `S${pad2(season)}E${pad2(index)}${extension}`;
}

function get_simple_filename_index(prefix, index, extension = '.jpg') {
  return `${prefix}${pad4(index)}${extension}`;
}

function get_ordered_filename(season, index, prefix, tv_show_mode, extension = '.mkv') {
  if (tv_show_mode) {
    return get_season_episode_for_file_index(index, season, extension);
  } else {
    return get_simple_filename_index(prefix, index, extension);
  }
}

// rename all files in a folder into S01Exx.mkv where xx is the relative
// file index.
async function rename_by_file_order(dir, dest_dir, prefix = '', season = 1, offset = 1, tv_show_mode = true) {
  log(`Renaming files in ${dir} based on file index...`);
  let index = offset;
  const {files} = await get_files(dir, !config.dot, config.recurse, config.force)
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const new_name = get_ordered_filename(season, index++, prefix, tv_show_mode, ext);
    const dest = path.join(dest_dir, new_name);
    try {
      rename(file, dest);
    } catch (e) {
      log_error(`Caught error: ${JSON.stringify(e)}`);
      if (!config.force) {
        throw e;
      }
    }
  }
}

// update the file modified time of each file in a dir
async function touch_dir(dir) {
  log(`Touching files in ${dir}...`);
  const {files} = await get_files(dir, !config.dot, config.recurse, config.force);
  const timestamp = new Date();
  timestamp.setFullYear(timestamp.getFullYear() - 1);
  for (const file of files) {
    try {
      log(`Touching ${file}...`);
      if (!config.dryrun) {
        fs.utimesSync(file, timestamp, timestamp);
      }
    } catch (e) {
      log_error(`Caught error: ${JSON.stringify(e)}`);
      if (!config.force) {
        throw e;
      }
    }
  }
}

function spawn(cmd, args) {
  log(`${cmd} ${args.join(' ')}`);
  if (config.dryrun) {
    return;
  }
  const options = {
    shell: true
  };
  const {output, stderr, error, status} = spawnSync(cmd, args, options);
  if (error) {
    log_error(`Failed to execute: ${stderr}`);
    throw error;
  }
  if (status !== 0) {
    log_error(`Failed to execute: exit code ${status}`);
    throw status;
  }
  log(output.join(' '));
}

const chdman_verb_map = {
  '.iso': 'createdvd',
  '.gdi': 'createcd',
  '.cue': 'createcd',
};

async function to_chd(src_dir, dest_dir, chdman) {
  log(`Converting disc images to chd in ${src_dir}...`);
  const {files} = await get_files(src_dir, !config.dot, true, config.force);

  for (const file of files) {
    try {
      const ext = path.extname(file);
      const chdman_verb = chdman_verb_map[ext.toLowerCase()];
      if (!chdman_verb) {
        continue;
      }

      const basename = path.basename(file, ext);
      const new_name = `${basename}.chd`;
      const new_file = path.join(dest_dir, new_name);
      const args = [chdman_verb, '-i', `"${file}"`, '-o', `"${new_file}"`];
      spawn(chdman, args);
      const verify_args = ['verify', '-i', `"${new_file}"`];
      spawn(chdman, verify_args);
    } catch (e) {
      log_error(`Caught error: ${JSON.stringify(e)}`);
      if (!config.force) {
        throw e;
      }
    }
  }
}

async function file_count(dir) {
  const {files} = await get_files(dir, !config.dot, config.recurse, config.force)
  return files.length;
}

async function check_one_extract_folder(basename, source_count, extract_path, missing_in_extract, content_missing_in_extract) {
  const extract_file_path = path.join(extract_path, basename);

  if (!fs.existsSync(extract_file_path)) {
    missing_in_extract.push(basename);
    return;
  }

  const extract_count = await file_count(extract_file_path);
  if ((source_count+1) !== extract_count) {
    content_missing_in_extract.push(basename);
  }
}

async function check_incoming(dir) {
  log(`Checking incoming folder ${dir}...`);
  const extract_path = path.join(dir, '!extract');
  const {files, dirs} = await get_files(dir, !config.dot, config.recurse, config.force);
  const missing_in_extract = [];
  const content_missing_in_extract = [];

  for (const dir of dirs) {
    try {
      const source_count = await file_count(dir);
      const dirname = path.basename(dir);
      await check_one_extract_folder(dirname, source_count, extract_path, missing_in_extract, content_missing_in_extract);
    } catch (e) {
      log_error(`Caught error: ${JSON.stringify(e)}`);
      if (!config.force) {
        throw e;
      }
    }
  }

  for (const file of files) {
    try {
      const filename = path.basename(file);
      await check_one_extract_folder(filename, 1, extract_path, missing_in_extract, content_missing_in_extract);
    } catch (e) {
      log_error(`Caught error: ${JSON.stringify(e)}`);
      if (!config.force) {
        throw e;
      }
    }
  }

  if (missing_in_extract.length > 0) {
    log('Folders missing from !extract:');
    for (const f of missing_in_extract) {
      log(f);
    }
  }

  if (content_missing_in_extract.length > 0) {
    log('Folders in !extract with missing content:');
    for (const f of content_missing_in_extract) {
      log(f);
    }
  }
}

const extract_extension_copy_whitelist_array = [
  '.avi',
  '.ts',
  '.mkv',
  '.mp4',
  '.m4v',
  '.wmv',
  '.srt',
  '.idx',
  '.sub',
];
const extract_extension_copy_whitelist = new Set(extract_extension_copy_whitelist_array);

function should_copy_one(filename) {
  const ext = path.extname(filename).toLowerCase();
  return extract_extension_copy_whitelist.has(ext);
}

const extract_extensions_archive_whitelist_array = [
  '.rar',
];
const extract_extension_archive_whitelist = new Set(extract_extensions_archive_whitelist_array);

function should_extract_one(filename) {
  const ext = path.extname(filename).toLowerCase();
  return extract_extension_archive_whitelist.has(ext);
}

// Extracct file/folder from |content_path| into a folder under |save_path|.
// Does not support --dryrun argument.
async function extract(content_path, save_path, rar) {
  const filename = path.basename(content_path);
  const extract_path = path.join(save_path, '!extract');
  const dest_path = path.join(extract_path, filename);
  const logfile = path.join(dest_path, '!extract.log');
  const rar_files = [];

  mkdir(dest_path);
  enable_file_logger(logfile);
  log(`Extracting...`);
  log(`Root: ${save_path}`);
  log(`Content: ${content_path}`);
  log(`Destination: ${dest_path}`);

  // Copy single file to output
  const v = fs.statSync(content_path);
  if (!v.isDirectory()) {
    if (should_copy_one(content_path)) {
      const dest_file = path.join(dest_path, filename);
      copy_file(content_path, dest_file);
    } else {
      log(`Skipping ${content_path}`);
    }
    return;
  }

  // Copy whitelisted file patterns to output
  fs.cpSync(content_path, dest_path, {
    recursive: true,
    filter(src, dst) {
      const v = fs.statSync(src);
      // Copy all subfolders
      if (v.isDirectory()) {
        return true;
      }

      // Remember if we saw any rar files
      if (should_extract_one(src)) {
        rar_files.push(src);
      }

      // Check file extension whitelist
      if (should_copy_one(src)) {
        log(`${src} => ${dst}`);
        return true;
      }

      log(`Skipping ${src}`);
      return false;
    }
  });

  // Try to extract any rars into the output
  for (const f of rar_files) {
    const args = ['x', '-y', '-idp', `"${f}"`, `"${dest_path}"`];
    spawn(`"${rar}"`, args);
  }
}

// replace prefix with replacement and remove suffix from all files in dir
function remove(dir, prefix, replacement = '', suffix = '') {
    fs_promises.readdir(dir).then(files => {
        let counter = 0;

        log(`Attempting to reformat files\n\tSource dir = "${dir}"\n\tPrefix = "${prefix}"\n\tReplacement = "${replacement}"\n\tSuffix = "${suffix}"`);

        for (const file of files) {
            fullpath = path.join(dir, file)
            const v = fs.statSync(fullpath)
            if (!v.isDirectory()) {
                log(`\t${file}...`);
                let new_name = file;

                if (file.startsWith(prefix)) {
                    log(`\t\tPrefix found`);
                    new_name = new_name.replace(prefix, replacement);
                }
                if (file.includes(suffix)) {
                    log(`\t\tSuffix found`);
                    new_name = new_name.replace(suffix, '');
                }

                if (new_name == file) {
                    log(`\t\tNothing to do`);
                    continue;
                }

                dest = path.join(dir, new_name);

                log(`\t\tRenaming:\n\t\t\t${fullpath}\n\t\t\t=>\n\t\t\t${dest}`);

                rename(fullpath, dest);
                counter++;
            }
        }
        log(`Renamed ${counter} files.`);
    })
}

function startup_tasks() {
  log(`Complex renamer app v0.1.2-alpha`);
  log(process.argv.join(' '));

  if (config.help || config.source === '') {
    print_usage();
    process.exit(-1);
  }

  log(`Using this config:`);
  log(config);
}

function cleanup_tasks() {
  file_logger.close();
}

async function perform_action() {
  const dest_dir = config.dest === '' ? config.source : config.dest;

  if (config.extract) {
    return extract(config.source, dest_dir, config.winrar);
  } else if (config.chd) {
    return to_chd(config.source, dest_dir, config.chdman);
  } else if (config.incoming) {
    return check_incoming(config.source);
  } else if (config.order) {
    const tv_show_mode = true;
    return rename_by_file_order(config.source, dest_dir, config.prefix, config.season, config.offset, tv_show_mode);
  } else if (config.touch) {
    return touch_dir(config.source);
  } else {
    remove(config.source, config.prefix, config.replacement, config.suffix);
  }
}

async function main() {
  try {
    startup_tasks();
    await perform_action();
    log(`Done`);
  } catch (e) {
    log_error(`Caught error: ${JSON.stringify(e)}`);
  } finally {
    cleanup_tasks();
  }
}

main();
