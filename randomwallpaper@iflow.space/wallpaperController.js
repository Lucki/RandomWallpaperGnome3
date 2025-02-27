const Mainloop = imports.gi.GLib;

// Filesystem
const Gio = imports.gi.Gio;

//self
const Self = imports.misc.extensionUtils.getCurrentExtension();
const SourceAdapter = Self.imports.sourceAdapter;
const Prefs = Self.imports.settings;
const Timer = Self.imports.timer;
const HistoryModule = Self.imports.history;

const LoggerModule = Self.imports.logger;

/*
 libSoup is accessed through the SoupBowl wrapper to support libSoup3 and libSoup2.4 simultaneously in the extension
 runtime and in the preferences window.
 */
const SoupBowl = Self.imports.soupBowl;

var WallpaperController = class {

	// Whether the controller instance was created in from the context of the preferences/settings window
	preferencesContext = false;

	constructor(prefsContext = false) {
		this.preferencesContext = prefsContext;
		this.logger = new LoggerModule.Logger('RWG3', 'WallpaperController');
		let xdg_cache_home = Mainloop.getenv('XDG_CACHE_HOME')
		if (!xdg_cache_home)
		{
			xdg_cache_home = `${Mainloop.getenv('HOME')}/.cache`
		}
		this.wallpaperlocation = `${xdg_cache_home}/${Self.metadata['uuid']}/wallpapers/`;
		let mode = parseInt('0755', 8);
		Mainloop.mkdir_with_parents(this.wallpaperlocation, mode)
		this.imageSourceAdapter = null;

		this._autoFetch = {
			active: false,
			duration: 30,
		};

		// functions will be called uppon loading a new wallpaper
		this._startLoadingHooks = [];
		// functions will be called when loading a new wallpaper stopped. If an error occured then the error will be passed as parameter.
		this._stopLoadingHooks = [];

		this._timer = new Timer.AFTimer();
		this._historyController = new HistoryModule.HistoryController(this.wallpaperlocation);

		this._settings = new Prefs.Settings();
		this._settings.observe('history-length', () => this._updateHistory());
		this._settings.observe('auto-fetch', () => this._updateAutoFetching());
		this._settings.observe('minutes', () => this._updateAutoFetching());
		this._settings.observe('hours', () => this._updateAutoFetching());

		this._unsplashAdapter = new SourceAdapter.UnsplashAdapter();
		this._wallhavenAdapter = new SourceAdapter.WallhavenAdapter();
		this._redditAdapter = new SourceAdapter.RedditAdapter();
		this._genericJsonAdapter = new SourceAdapter.GenericJsonAdapter();

		this._updateHistory();
		this._updateAutoFetching();

		this.currentWallpaper = this._getCurrentWallpaper();
	}

	_updateHistory() {
		this._historyController.load();
	}

	_updateAutoFetching() {
		let duration = 0;
		duration += this._settings.get('minutes', 'int');
		duration += this._settings.get('hours', 'int') * 60;
		this._autoFetch.duration = duration;
		this._autoFetch.active = this._settings.get('auto-fetch', 'boolean');

		// only start timer if not in context of preferences window
		if (!this.preferencesContext && this._autoFetch.active) {
			this._timer.registerCallback(() => this.fetchNewWallpaper());
			this._timer.setMinutes(this._autoFetch.duration);
			this._timer.start();
		} else {
			this._timer.stop();
		}

		// load a new wallpaper on startup (only if not in preferences context)
		if (!this.preferencesContext && this._settings.get("fetch-on-startup", "boolean")) {
			this.fetchNewWallpaper();
		}
	}

	/*
	 forwards the request to the adapter
	 */
	_requestRandomImageFromAdapter(callback) {
		this.imageSourceAdapter = this._unsplashAdapter;

		switch (this._settings.get('source', 'enum')) {
			case 0:
				this.imageSourceAdapter = this._unsplashAdapter;
				break;
			case 1:
				this.imageSourceAdapter = this._wallhavenAdapter;
				break;
			case 2:
				this.imageSourceAdapter = this._redditAdapter;
				break;
			case 3:
				this.imageSourceAdapter = this._genericJsonAdapter;
				break;
			default:
				this.imageSourceAdapter = this._unsplashAdapter;
				break;
		}

		this.imageSourceAdapter.requestRandomImage(callback);
	}

	/**
	 * copy file from uri to local wallpaper directory and calls the given callback with the name and the full filepath
	 * of the written file as parameter.
	 * @param uri
	 * @param callback(name, path, error)
	 * @private
	 */
	_fetchFile(uri, callback) {
		//extract the name from the url and
		let date = new Date();
		let name = date.getTime() + '_' + this.imageSourceAdapter.fileName(uri); // timestamp ensures uniqueness

		let bowl = new SoupBowl.Bowl();

		let file = Gio.file_new_for_path(this.wallpaperlocation + String(name));
		let fstream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);

		// start the download
		let request = bowl.Soup.Message.new('GET', uri);

		bowl.send_and_receive(request, (response_data_bytes) => {
			if (!response_data_bytes) {
				fstream.close(null);

				if (callback) {
					callback(null, null, 'Not a valid response');
				}

				return;
			}

			try {
				fstream.write(response_data_bytes, null);

				fstream.close(null);

				// call callback with the name and the full filepath of the written file as parameter
				if (callback) {
					callback(name, file.get_path());
				}
			} catch (e) {
				if (callback) {
					callback(null, null, e);
				}
			}
		});
	}

	/**
	 * Sets the wallpaper and the lockscreen when enabled to the given path. Executes the callback on success.
	 * @param path
	 * @param callback
	 * @private
	 */
	_setBackground(path, callback) {
		let background_setting = new Gio.Settings({schema: "org.gnome.desktop.background"});
		path = "file://" + path;

		this._setPictureUriOfSettingsObject(background_setting, path, () => {
			if (this._settings.get('change-lock-screen', 'boolean')) {
				let screensaver_setting = new Gio.Settings({schema: "org.gnome.desktop.screensaver"});

				this._setPictureUriOfSettingsObject(screensaver_setting, path, () => {
					// call callback if given
					if (callback) {
						callback();
					}
				});
			} else {
				// call callback if given
				if (callback) {
					callback();
				}
			}
		});
	}

	/**
	 * Set the picture-uri property of the given settings object to the path.
	 * Precondition: the settings object has to be a valid Gio settings object with the picture-uri property.
	 * @param settings
	 * @param path
	 * @param callback
	 * @private
	 */
	_setPictureUriOfSettingsObject(settings, path, callback) {
		/*
		 inspired from:
		 https://bitbucket.org/LukasKnuth/backslide/src/7e36a49fc5e1439fa9ed21e39b09b61eca8df41a/backslide@codeisland.org/settings.js?at=master
		 */
		let set_prop = (property) => {
			if (settings.is_writable(property)) {
				// Set a new Background-Image (should show up immediately):
				if (!settings.set_string(property, path)) {
					this._bailOutWithCallback(`Failed to write property: ${property}`, callback);
				}
			} else {
				this._bailOutWithCallback(`Property not writable: ${property}`, callback);
			}
		}

		const availableKeys = settings.list_keys();

		let property = "picture-uri";
		if (availableKeys.indexOf(property) !== -1) {
			set_prop(property);
		}

		property = "picture-uri-dark";
		if (availableKeys.indexOf(property) !== -1) {
			set_prop(property);
		}

		Gio.Settings.sync(); // Necessary: http://stackoverflow.com/questions/9985140

		// call callback if given
		if (callback) {
			callback();
		}
	}

	_getCurrentWallpaper() {
		let background_setting = new Gio.Settings({schema: "org.gnome.desktop.background"});
		return background_setting.get_string("picture-uri").replace(/^(file:\/\/)/, "");
	}

	setWallpaper(historyId) {
		let historyElement = this._historyController.get(historyId);

		if (this._historyController.promoteToActive(historyElement.id)) {
			this._setBackground(historyElement.path);
			this.currentWallpaper = this._getCurrentWallpaper();
		} else {
			this.logger.warn("The history id (" + historyElement.id + ") could not be found.")
			// TODO: Error handling	history id not found.
		}
	}

	fetchNewWallpaper(callback) {
		this._startLoadingHooks.forEach((element) => {
			element();
		});

		this._timer.reset(); // reset timer

		this._requestRandomImageFromAdapter((historyElement, error) => {
			if (historyElement == null || error) {
				this._bailOutWithCallback("Could not fetch wallpaper location.", callback);
				this._stopLoadingHooks.map(element => element(null));
				return;
			}

			this.logger.info("Requesting image: " + historyElement.source.imageDownloadUrl);

			this._fetchFile(historyElement.source.imageDownloadUrl, (historyId, path, error) => {
				if (error) {
					this._bailOutWithCallback(`Could not load new wallpaper: ${error}`, callback);
					this._stopLoadingHooks.forEach(element => element(null));
					return;
				}

				historyElement.path = path;
				historyElement.id = historyId;

				this._setBackground(path, () => {
					// insert file into history
					this._historyController.insert(historyElement);
					this.currentWallpaper = this._getCurrentWallpaper();

					this._stopLoadingHooks.forEach(element => element(null));

					// call callback if given
					if (callback) {
						callback();
					}
				});
			});
		});
	}

	_backgroundTimeout(delay) {
		if (this.timeout) {
			return;
		}

		delay = delay || 200;

		this.timeout = Mainloop.timeout_add(Mainloop.PRIORITY_DEFAULT, delay, () => {
			this.timeout = null;
			if (this._resetWallpaper) {
				this._setBackground(this.currentWallpaper);
				this._resetWallpaper = false;
			} else {
				this._setBackground(this.wallpaperlocation + this.previewId);
			}
			return false;
		});
	}

	previewWallpaper(historyid, delay) {
		if (!this._settings.get('disable-hover-preview', 'boolean')) {
			this.previewId = historyid;
			this._resetWallpaper = false;

			this._backgroundTimeout(delay);
		}
	}

	resetWallpaper() {
		if (!this._settings.get('disable-hover-preview', 'boolean')) {
			this._resetWallpaper = true;
			this._backgroundTimeout();
		}
	}

	getHistoryController() {
		return this._historyController;
	}

	deleteHistory() {
		this._historyController.clear();
	}

	update() {
		this._updateHistory();
		this.currentWallpaper = this._getCurrentWallpaper();
	}

	registerStartLoadingHook(fn) {
		if (typeof fn === "function") {
			this._startLoadingHooks.push(fn)
		}
	}

	registerStopLoadingHook(fn) {
		if (typeof fn === "function") {
			this._stopLoadingHooks.push(fn)
		}
	}

	_bailOutWithCallback(msg, callback) {
		this.logger.error(msg);

		if (callback) {
			callback();
		}
	}

};
