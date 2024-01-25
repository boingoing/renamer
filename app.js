import path from 'path'
import fs from 'fs'
import {parseArgs} from 'node:util'
import {mkdirp} from 'mkdirp'

const fs_promises = fs.promises;

function print_usage() {
  console.log(`node app.js --source path [--dest path] [--prefix string] [--replacement string] [--suffix string] [--order] [--season number] [--offset number] [--copy] [--dryrun] [--force] [--touch] [--incoming] [--recurse] [--help]`);
  console.log(`  --source path  Searches for files to rename in directory named by path`);
  console.log(`  --dest path  Places renamed files into directory named by path`);
  console.log(`  --prefix string  When renaming based on filenames, looks for string as a prefix of each filename. When renaming based on file order, this prefix is used as the base filename unless TV show mode is enabled.`);
  console.log(`  --replacement string  Replace the string found via --prefix with this string when renaming based on filenames`);
  console.log(`  --suffix string  Looks for string as a suffix of each filename (and removes it during rename) when renaming based on filenames`);
  console.log(`  --order  Renames files based on their sort order within the directory`);
  console.log(`  --season number  When renaming based on sort order, use number as season. Only applies when TV show mode is enabled.`);
  console.log(`  --offset number  When renaming based on file order, starts numbering files from this offset. In TV show mode, this is the episode number.`)
  console.log(`  --copy  Copy the files from source rather than moving them during rename`);
  console.log(`  --dryrun  Does everything but perform the actual rename on files`);
  console.log(`  --force  Continue on error`);
  console.log(`  --touch  Touch the files in source path but do not rename them`);
  console.log(`  --incoming  Check the extract folder in an incoming folder for missing files`);
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

function rename(fullpath, dest) {
  console.log(`${fullpath} => ${dest}`);
  if (!config.dryrun) {
    if (config.copy) {
      fs.copyFileSync(fullpath, dest);
    } else {
      fs.renameSync(fullpath, dest);
    }
  }
}

function get_season_episode_for_file_index(index, season = 1, extension = 'mkv') {
  return `S${pad2(season)}E${pad2(index)}.${extension}`;
}

function get_simple_filename_index(prefix, index, extension = 'jpg') {
  return `${prefix}${pad4(index)}.${extension}`;
}

function get_ordered_filename(season, index, prefix, tv_show_mode, extension = 'mkv') {
  if (tv_show_mode) {
    return get_season_episode_for_file_index(index, season, extension);
  } else {
    return get_simple_filename_index(prefix, index, extension);
  }
}

// rename all files in a folder into S01Exx.mkv where xx is the relative
// file index.
function rename_by_file_order(dir, dest_dir, prefix = '', season = 1, offset = 1, tv_show_mode = true) {
  console.log(`Renaming files in ${dir} based on file index...`);
  fs_promises.readdir(dir).then(files => {
    let index = offset;
    for (file of files) {
      const fullpath = path.join(dir, file);
      const new_name = get_ordered_filename(season, index++, prefix, tv_show_mode);
      const dest = path.join(dest_dir, new_name);
      try {
        const v = fs.statSync(fullpath);
        if (v.isDirectory()) {
          console.log(`Skipping subdirectory ${fullpath}.`);
          continue;
        }
        rename(fullpath, dest);
      } catch (e) {
        console.error(`Caught error: ${JSON.stringify(e)}`);
        if (!config.force) {
          throw e;
        }
      }
    }
  });
}

// update the file modified time of each file in a dir
function touch_dir(dir) {
  console.log(`Touching files in ${dir}...`);
  fs_promises.readdir(dir).then(files => {
    const timestamp = new Date();
    timestamp.setFullYear(timestamp.getFullYear() - 1);
    for (file of files) {
      const fullpath = path.join(dir, file);
      try {
        const v = fs.statSync(fullpath);
        if (v.isDirectory()) {
          console.log(`Skipping subdirectory ${fullpath}.`);
          continue;
        }
        console.log(`Touching ${fullpath}...`);
        if (!config.dryrun) {
          fs.utimesSync(fullpath, timestamp, timestamp);
        }
      } catch (e) {
        console.error(`Caught error: ${JSON.stringify(e)}`);
        if (!config.force) {
          throw e;
        }
      }
    }
  });
}

async function file_count(dir) {
  const files = await fs_promises.readdir(dir);
  return files.length;
}

async function check_incoming(dir) {
  console.log(`Checking incoming folder ${dir}...`);
  const extract_path = path.join(dir, '!extract');
  const files = await fs_promises.readdir(dir);
  const missing_in_extract = []
  const content_missing_in_extract = []

  for (file of files) {
    const fullpath = path.join(dir, file);
    const v = fs.statSync(fullpath);

    try {
      const source_count = v.isDirectory() ? await file_count(fullpath) : 1;
      const extract_file_path = path.join(extract_path, file);

      if (!fs.existsSync(extract_file_path)) {
        missing_in_extract.push(file);
        continue;
      }

      const extract_count = await file_count(extract_file_path);

      if ((source_count+1) !== extract_count) {
        content_missing_in_extract.push(file);
      }
    } catch (e) {
      console.error(`Caught error: ${JSON.stringify(e)}`);
      if (!config.force) {
        throw e;
      }
    }
  }

  if (missing_in_extract.length > 0) {
    console.log('Folders missing from !extract:');
    for (const f of missing_in_extract) {
      console.log(f);
    }
  }

  if (content_missing_in_extract.length > 0) {
    console.log('Folders in !extract with missing content:');
    for (const f of content_missing_in_extract) {
      console.log(f);
    }
  }
}

// sort all files in dir into folders based on file timestamp
// dir\\file -> dir\\%year%\\%month%\\file
function dostuff(dir) {
    fs_promises.readdir(dir).then(files => {
        for (file of files) {
            fullpath = path.join(dir, file)
            const v = fs.statSync(fullpath)
            if (!v.isDirectory()) {
                const year = `${v.mtime.getFullYear()}`;
                const month = `${pad2(v.mtime.getMonth() + 1)}`;
                const date_dest = path.join(dir, year, month);
                const dest = path.join(date_dest, file);

                mkdirp(date_dest);
                console.log(`${fullpath} => ${dest}`);
                fs.renameSync(fullpath, dest);
            }
        }
    });
}

// remove 'xxxx - ' prefix from all files in dir
function remove_prefix(dir) {
    fs_promises.readdir(dir).then(files => {
        for (file of files) {
            fullpath = path.join(dir, file)
            const v = fs.statSync(fullpath)
            if (!v.isDirectory()) {
                const regex = /....\ \-\ (.*)$/
                const found = file.match(regex);
                dest = path.join(dir, found[1])
                console.log(`${fullpath} => ${dest}`);
                fs.renameSync(fullpath, dest);
            }
        }
    })
}

// remove '3DSxxxx - ' prefix and replace 'Decrypted' with '(Decrypted)' from all files in dir
function remove_3ds_prefix(dir) {
    fs_promises.readdir(dir).then(files => {
        let counter = 0;
        for (file of files) {
            fullpath = path.join(dir, file)
            const v = fs.statSync(fullpath)
            if (!v.isDirectory()) {
                const regex = /3DS....\ \-\ (.*)$/
                const found = file.match(regex);
                if (!found)
                    continue;
                dest = path.join(dir, found[1])
                console.log(`${fullpath} => ${dest}`);
                fs.renameSync(fullpath, dest);
                counter++;
            }
        }
        console.log(`Renamed ${counter} files.`);
    })
}


// SxxExx - (title) (1987) dvdrip (1987) dvdrip (Encoder = DragonVsKira).mp4
function rename_tmnt(dir) {
    fs_promises.readdir(dir).then(files => {
        let counter = 0;
        for (file of files) {
            fullpath = path.join(dir, file)
            const v = fs.statSync(fullpath)
            if (!v.isDirectory()) {
                const regex = /^(S..E..) - (.*) \(1987\) dvdrip \(Encoder = DragonVsKira\)\.mp4$/
                const found = file.match(regex);
                if (!found)
                    continue;
                dest = path.join(dir, `Teenage Mutant Ninja Turtles (1987) ${found[1]} - ${found[2]}.mp4`)
                console.log(`${fullpath} => ${dest}`);
                fs.renameSync(fullpath, dest);
                counter++;
            }
        }
        console.log(`Renamed ${counter} files.`);
    })
}

// replace prefix with replacement and remove suffix from all files in dir
function remove(dir, prefix, replacement = '', suffix = '') {
    fs_promises.readdir(dir).then(files => {
        let counter = 0;

        console.log(`Attempting to reformat files\n\tSource dir = "${dir}"\n\tPrefix = "${prefix}"\n\tReplacement = "${replacement}"\n\tSuffix = "${suffix}"`);

        for (file of files) {
            fullpath = path.join(dir, file)
            const v = fs.statSync(fullpath)
            if (!v.isDirectory()) {
                console.log(`\t${file}...`);
                let new_name = file;

                if (file.startsWith(prefix)) {
                    console.log(`\t\tPrefix found`);
                    new_name = new_name.replace(prefix, replacement);
                }
                if (file.includes(suffix)) {
                    console.log(`\t\tSuffix found`);
                    new_name = new_name.replace(suffix, '');
                }

                if (new_name == file) {
                    console.log(`\t\tNothing to do`);
                    continue;
                }

                dest = path.join(dir, new_name);

                console.log(`\t\tRenaming:\n\t\t\t${fullpath}\n\t\t\t=>\n\t\t\t${dest}`);

                rename(fullpath, dest);
                counter++;
            }
        }
        console.log(`Renamed ${counter} files.`);
    })
}

console.log(`Complex renamer app v0.1.1-alpha`);

if (config.help || config.source === '') {
  print_usage();
  process.exit(-1);
}

console.log(`Using this config:`);
console.log(config);

if (config.incoming) {
  check_incoming(config.source);
} else if (config.order) {
  const dest_dir = config.dest === '' ? config.source : config.dest;
  const tv_show_mode = true;
  rename_by_file_order(config.source, dest_dir, config.prefix, config.season, config.offset, tv_show_mode);
} else if (config.touch) {
  touch_dir(config.source);
} else {
  remove(config.source, config.prefix, config.replacement, config.suffix);
}
