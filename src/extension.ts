import type * as LoggerNamespace from './logger.js';
import type * as AFTimer from './timer.js';
import type * as WallpaperControllerNamespace from './wallpaperController.js';
import type * as RandomWallpaperMenuNamespace from './randomWallpaperMenu.js';
let Logger: typeof LoggerNamespace;
let Timer: typeof AFTimer;
let WallpaperController: typeof WallpaperControllerNamespace;
let RandomWallpaperMenu: typeof RandomWallpaperMenuNamespace;

/**
 *
 */
// eslint-disable-next-line no-unused-vars
function init() {
    return new Extension();
}

class Extension {
    private _logger: LoggerNamespace.Logger | undefined;
    private _wallpaperController: WallpaperControllerNamespace.WallpaperController | undefined;
    private _panelMenu: RandomWallpaperMenuNamespace.RandomWallpaperMenu | undefined;
    private _timer: AFTimer.AFTimer | undefined;

    enable() {
        // Dynamically load own modules. This allows us to use proper ES6 Modules
        this._importModules().then(() => {
            this._logger = new Logger.Logger('RWG3', 'Main');
            this._timer = Timer.AFTimer.getTimer();
            this._wallpaperController = new WallpaperController.WallpaperController();
            this._panelMenu = new RandomWallpaperMenu.RandomWallpaperMenu(this._wallpaperController);

            this._logger.info('Enable extension.');
            this._panelMenu.init();
        }).catch(error => {
            if (this._logger) {
                this._logger.error(error);
                logError(error);
            } else {
                logError(error);
            }
        });
    }

    disable() {
        if (this._logger)
            this._logger.info('Disable extension.');


        if (this._panelMenu)
            this._panelMenu.cleanup();


        // cleanup the timer singleton
        if (this._timer)
            this._timer.cleanup();
    }

    private async _importModules() {
        // All imports as dynamic loads to work around the fact this module won't be in a topmost
        // context inside the gnome shell and can't use import statements (yet).
        // PopOS' tiling extension and RoundedCorners Extension work around the above limitation by
        // manually rewriting the exported javascript file. We also have to do this but
        // not for our own modules.
        const loggerPromise = import('./logger');
        const timerPromise = import('./timer');
        const wallpaperPromise = import('./wallpaperController');
        const menuPromise = import('./randomWallpaperMenu');

        const [moduleLogger, moduleTimer, moduleWallpaper, moduleMenu] = await Promise.all([
            loggerPromise, timerPromise, wallpaperPromise, menuPromise,
        ]);

        Logger = moduleLogger;
        Timer = moduleTimer;
        WallpaperController = moduleWallpaper;
        RandomWallpaperMenu = moduleMenu;
    }
}
