import { DOM, Patcher, ReactUtils, Utils, Webpack } from "@api";
import manifest from "@manifest";
import Styles from "@styles";
import React from "react";

import showChangelog from "../common/Changelog";
import StatusIndicators from "./components/indicators";
import SettingsPanel from "./components/settings";
import Settings from "./modules/settings";
import { findInReactTree } from "./modules/utils";

export default class PlatformIndicators {
    getSettingsPanel() {
        return <SettingsPanel />;
    }

    start() {
        this.dmListPatched = false;
        this.dmListRetryTimer = null;
        this.friendListPatched = false;
        this.friendListRetryTimer = null;
        Styles.load();
        showChangelog(manifest);
        this.patchDMList();
        this.patchMemberList();
        this.patchChat();
        this.patchBadges();
        this.patchFriendList();
    }

    queueDMListPatchRetry() {
        if (this.dmListPatched || this.dmListRetryTimer) return;

        this.dmListRetryTimer = setTimeout(() => {
            this.dmListRetryTimer = null;
            this.patchDMList();
        }, 1500);
    }

    patchDMList() {
        const UserContext = React.createContext(null);
        const ChannelWrapper = Webpack.getBySource("activities", "isMultiUserDM", "isMobile");
        const NameWrapper = Webpack.getBySource("AvatarWithText")?.A;
        const ChannelClasses = Webpack.getByKeys("channel", "decorator");
        const channelWrapperKey = typeof ChannelWrapper?.Ay === "function" ? "Ay" : null;

        if (!channelWrapperKey || typeof NameWrapper?.render !== "function") {
            this.queueDMListPatchRetry();
            return;
        }

        this.dmListPatched = true;

        Patcher.after(ChannelWrapper, channelWrapperKey, (_, __, res) => {
            if (!Settings.get("showInDmsList", true)) return;
            if (!res || typeof res.type !== "function") return;

            Patcher.after(res, "type", (_, [props], res) => {
                if (!props.user) return; // Its a group DM
                if (Settings.get("ignoreBots", true) && props.user.bot) return;

                return (
                    <UserContext.Provider value={props.user}>
                        {res}
                    </UserContext.Provider>
                );
            });
        });

        const ChannelWrapperElement = ChannelClasses?.channel ? document.querySelector(`h2 + .${ChannelClasses.channel}`) : null;
        if (ChannelWrapperElement) {
            const ChannelWrapperInstance = ReactUtils.getOwnerInstance(ChannelWrapperElement);
            if (ChannelWrapperInstance) ChannelWrapperInstance.forceUpdate();
        }

        Patcher.after(NameWrapper, "render", (_, __, res) => {
            if (!Settings.get("showInDmsList", true)) return;

            const user = React.useContext(UserContext);
            if (!user) return;

            const child = Utils.findInTree(res, e => e?.className?.includes("nameAndDecorators"), { walkable: ["children", "props"] });
            if (!child) return;

            child.style = { justifyContent: "unset" };
            child.children.push(
                <StatusIndicators
                    userId={user.id}
                    type="DMs"
                />
            );
        });
    }

    patchMemberList() {
        const [MemberItem, key] = Webpack.getWithKey(Webpack.Filters.byStrings("nameplate:", ".MEMBER_LIST"));

        Patcher.after(MemberItem, key, (_, [props], ret) => {
            const user = props.avatar.props.user;
            if (ret?.props?.className?.includes("placeholder")) return;
            if (!Settings.get("showInMemberList", true)) return;
            if (Settings.get("ignoreBots", true) && user.bot) return;
            const child = findInReactTree(ret, e => e?.className?.includes("username"));
            if (user && child) {
                child.children = [
                    child.children,
                    <StatusIndicators
                        userId={user.id}
                        type="MemberList"
                    />
                ];
            }
        });
    }

    patchChat() {
        const [ChatUsername, key] = Webpack.getWithKey(Webpack.Filters.byStrings(".guildMemberAvatar&&null!="));

        Patcher.before(ChatUsername, key, (_, props) => {
            const mainProps = props[0];
            if (!Settings.get("showInChat", true)) return;
            if (Settings.get("ignoreBots", true) && mainProps?.author?.bot) return;
            if (!mainProps?.decorations) return;
            const target = mainProps.decorations?.[1];
            if (!Array.isArray(target)) mainProps.decorations[1] = target ? [target] : [];
            mainProps.decorations[1].unshift(
                <StatusIndicators
                    userId={mainProps.message.author.id}
                    type="Chat"
                />
            );
        });
    }

    patchBadges() {
        const [BadgeList, Key_BL] = Webpack.getWithKey(Webpack.Filters.byStrings("badges", "badgeClassName", ".BADGE"));

        Patcher.after(BadgeList, Key_BL, (_, [{ displayProfile }], res) => {
            if (!Settings.get("showInBadges", true)) return;
            if (Settings.get("ignoreBots", true) && displayProfile?.application) return;
            if (!displayProfile?.userId) return;
            res.props.children.push(
                <StatusIndicators
                    userId={displayProfile.userId}
                    type="Badge"
                    separator
                />
            );
        });
    }

    queueFriendListPatchRetry() {
        if (this.friendListPatched || this.friendListRetryTimer) return;

        this.friendListRetryTimer = setTimeout(() => {
            this.friendListRetryTimer = null;
            this.patchFriendList();
        }, 1500);
    }

    patchFriendList() {
        if (!Settings.get("showInFriendsList", true)) return;
        const UserInfo = Webpack.getBySource("user", "subText", "showAccountIdentifier")?.A;
        const FriendListClasses = Webpack.getByKeys("userInfo", "hovered");

        if (typeof UserInfo !== "function" || !FriendListClasses?.discriminator || !FriendListClasses?.hovered) {
            this.queueFriendListPatchRetry();
            return;
        }

        this.friendListPatched = true;

        DOM.addStyle("PlatformIndicators", `
            .${FriendListClasses.discriminator} { display: none; }
            .${FriendListClasses.hovered} .${FriendListClasses.discriminator} { display: unset; }
        `);

        const unpatch = Patcher.after(UserInfo.prototype, "render", (_, __, res) => {
            unpatch();
            if (!res?.type?.prototype) return;
            Patcher.after(res.type.prototype, "render", (_, __, res) => {
                if (!res || typeof res.type !== "function") return;
                const unpatch2 = Patcher.after(res, "type", (_, __, res) => {
                    unpatch2();
                    const child = Utils.findInTree(res, e => e?.className?.includes("listItemContents"), { walkable: ["children", "props"] });
                    if (!child) return;

                    const userId = findInReactTree(res, e => e?.user, { walkable: ["props", "children"] })?.user?.id;
                    if (!userId) return;

                    if (!child.children?.[0] || typeof child.children[0].type !== "function") return;
                    const unpatch3 = Patcher.after(child.children[0], "type", (_, __, res) => {
                        unpatch3();
                        if (!res?.props?.children) return;
                        res.props.children.push(
                            <StatusIndicators
                                userId={userId}
                                type="FriendList"
                            />
                        );
                    });
                });
            });
        });
    }

    stop() {
        clearTimeout(this.dmListRetryTimer);
        clearTimeout(this.friendListRetryTimer);
        Patcher.unpatchAll();
        DOM.removeStyle("PlatformIndicators");
        Styles.unload();
    }
}
